// Optional MacBook trackpad input. All lifecycle calls have one owner (the Rust worker).
#include <CoreFoundation/CoreFoundation.h>
#include <dlfcn.h>
#include <math.h>
#include <pthread.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include <time.h>

typedef struct { float x, y; } Position;
typedef struct { Position position, velocity; } Motion;
typedef struct {
    int32_t frame;
    double timestamp;
    int32_t path, state, finger, hand;
    Motion normalized;
    float total;
    int32_t reserved;
    float angle, major, minor;
    Motion absolute;
    int32_t reserved2[2];
    float density;
} Contact;
_Static_assert(sizeof(Contact) == 96 && offsetof(Contact, normalized) == 32, "unexpected contact ABI");

enum { MAX_CONTACTS = 16 };
typedef struct { int32_t id; float x, y; } PadPoint;
typedef int (*FrameCallback)(CFTypeRef, const Contact *, int, double, int);
static CFArrayRef devices;
static CFTypeRef device;
static pthread_mutex_t mutex = PTHREAD_MUTEX_INITIALIZER;
static PadPoint points[MAX_CONTACTS], last_single;
static int count;
static uint64_t single_until;
static bool accepting;
static void (*unregister_frame)(CFTypeRef, FrameCallback);
static int (*stop_device)(CFTypeRef);

static uint64_t millis(void) {
    return clock_gettime_nsec_np(CLOCK_UPTIME_RAW) / 1000000;
}

static int on_frame(CFTypeRef sender, const Contact *contacts, int length, double time, int frame) {
    (void)time;
    (void)frame;
    pthread_mutex_lock(&mutex);
    if (accepting && sender == device) {
        int previous = count;
        count = 0;
        if (length >= 0 && length <= MAX_CONTACTS && (length == 0 || contacts)) {
            for (int i = 0; i < length; ++i) {
                const Contact *c = &contacts[i];
                Position p = c->normalized.position;
                if ((c->state == 3 || c->state == 4) && isfinite(p.x) && isfinite(p.y)
                    && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1) {
                    points[count++] = (PadPoint){ c->path, p.x, 1 - p.y };
                }
            }
        }
        if (count == 1) last_single = points[0];
        if (count > 0) single_until = 0;
        else if (previous == 1) single_until = millis() + 140; // tap-to-click can follow lift
    }
    pthread_mutex_unlock(&mutex);
    return 0; // Observe only; preserve system gestures.
}

int kc_pad_start(void) {
    static void *library;
    if (!library) library = dlopen("/System/Library/PrivateFrameworks/MultitouchSupport.framework/MultitouchSupport", RTLD_LOCAL | RTLD_NOW);
    if (!library) return -1;
    CFArrayRef (*list)(void) = dlsym(library, "MTDeviceCreateList");
    bool (*built_in)(CFTypeRef) = dlsym(library, "MTDeviceIsBuiltIn");
    void (*register_frame)(CFTypeRef, FrameCallback) = dlsym(library, "MTRegisterContactFrameCallback");
    unregister_frame = dlsym(library, "MTUnregisterContactFrameCallback");
    int (*start_device)(CFTypeRef, int) = dlsym(library, "MTDeviceStart");
    stop_device = dlsym(library, "MTDeviceStop");
    if (!list || !built_in || !register_frame || !unregister_frame || !start_device || !stop_device) return -1;
    devices = list();
    if (!devices) return -1;
    for (CFIndex i = 0; i < CFArrayGetCount(devices); ++i) {
        CFTypeRef candidate = CFArrayGetValueAtIndex(devices, i);
        if (!built_in(candidate)) continue;
        pthread_mutex_lock(&mutex);
        device = candidate;
        accepting = true;
        pthread_mutex_unlock(&mutex);
        register_frame(device, on_frame);
        int result = start_device(device, 0);
        if (result == 0) return 0;
        pthread_mutex_lock(&mutex);
        accepting = false;
        count = 0;
        single_until = 0;
        pthread_mutex_unlock(&mutex);
        unregister_frame(device, on_frame);
        break;
    }
    device = NULL;
    CFRelease(devices);
    devices = NULL;
    return -1;
}

void kc_pad_stop(void) {
    pthread_mutex_lock(&mutex);
    accepting = false;
    count = 0;
    single_until = 0;
    pthread_mutex_unlock(&mutex);
    if (device) {
        stop_device(device);
        unregister_frame(device, on_frame);
        device = NULL;
        CFRelease(devices);
        devices = NULL;
    }
}

int kc_pad_snapshot(PadPoint *out) {
    pthread_mutex_lock(&mutex);
    int n = count;
    memcpy(out, points, n * sizeof(*out));
    pthread_mutex_unlock(&mutex);
    return n;
}

bool kc_pad_click(PadPoint *out) {
    pthread_mutex_lock(&mutex);
    bool found = accepting && (count == 1 || (count == 0 && single_until > millis()));
    if (found) *out = last_single;
    pthread_mutex_unlock(&mutex);
    return found;
}
