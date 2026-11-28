// Optional macOS trackpad input (built-in MacBook trackpad + external Apple Magic Trackpad).
// All lifecycle calls have one owner (the Rust worker).
#include <CoreFoundation/CoreFoundation.h>
#include <dlfcn.h>
#include <math.h>
#include <pthread.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

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

enum { MAX_CONTACTS = 16, MAX_DEVICES = 8 };
typedef struct { int32_t id; float x, y; } PadPoint;
typedef int (*FrameCallback)(CFTypeRef, const Contact *, int, double, int);

static void *library;
static CFArrayRef (*mt_list)(void);
static CFTypeRef (*mt_default)(void);
static bool (*mt_built_in)(CFTypeRef);
static int (*mt_sensor_dims)(CFTypeRef, int *, int *);
static void (*register_frame)(CFTypeRef, FrameCallback);
static void (*unregister_frame)(CFTypeRef, FrameCallback);
static int (*start_device)(CFTypeRef, int);
static int (*stop_device)(CFTypeRef);

static CFArrayRef devices;
static CFTypeRef default_device;
static CFTypeRef active_devices[MAX_DEVICES];
static int device_count;
static CFTypeRef active_sender;
static pthread_mutex_t mutex = PTHREAD_MUTEX_INITIALIZER;
static PadPoint points[MAX_CONTACTS], last_touch;
static int count;
static uint64_t touch_until;
static bool accepting;

static uint64_t millis(void) {
    return clock_gettime_nsec_np(CLOCK_UPTIME_RAW) / 1000000;
}

static float clamp01(float v) {
    return v < 0.0f ? 0.0f : (v > 1.0f ? 1.0f : v);
}

static bool is_known_device(CFTypeRef sender) {
    for (int i = 0; i < device_count; ++i) {
        if (active_devices[i] == sender) return true;
    }
    return false;
}

static PadPoint centroid_of(const PadPoint *pts, int n) {
    if (n <= 1) return pts[0];
    float sx = 0.0f, sy = 0.0f;
    for (int i = 0; i < n; ++i) {
        sx += pts[i].x;
        sy += pts[i].y;
    }
    return (PadPoint){ pts[0].id, sx / (float)n, sy / (float)n };
}

static bool load_framework(void) {
    static bool attempted;
    static bool ready;
    if (attempted) return ready;
    attempted = true;
    library = dlopen("/System/Library/PrivateFrameworks/MultitouchSupport.framework/MultitouchSupport", RTLD_LOCAL | RTLD_NOW);
    if (!library) return false;
    mt_list = dlsym(library, "MTDeviceCreateList");
    mt_default = dlsym(library, "MTDeviceCreateDefault");
    mt_built_in = dlsym(library, "MTDeviceIsBuiltIn");
    mt_sensor_dims = dlsym(library, "MTDeviceGetSensorSurfaceDimensions");
    register_frame = dlsym(library, "MTRegisterContactFrameCallback");
    unregister_frame = dlsym(library, "MTUnregisterContactFrameCallback");
    start_device = dlsym(library, "MTDeviceStart");
    stop_device = dlsym(library, "MTDeviceStop");
    ready = (mt_list || mt_default) && register_frame && unregister_frame && start_device && stop_device;
    return ready;
}

static bool is_trackpad_device(CFTypeRef candidate) {
    if (!candidate) return false;
    // Built-in MacBook trackpad is always accepted.
    if (mt_built_in && mt_built_in(candidate)) return true;
    // External Magic Trackpad has a landscape sensor (w >= h); Magic Mouse is portrait (w < h).
    if (mt_sensor_dims) {
        int w = 0, h = 0;
        if (mt_sensor_dims(candidate, &w, &h) == 0 && w > 0 && h > 0 && w < h) {
            return false;
        }
    }
    return true;
}

static int on_frame(CFTypeRef sender, const Contact *contacts, int length, double time, int frame) {
    (void)time;
    (void)frame;
    pthread_mutex_lock(&mutex);
    if (accepting && is_known_device(sender)) {
        PadPoint parsed[MAX_CONTACTS];
        int n = 0;
        if (length > 0 && contacts) {
            int limit = length < MAX_CONTACTS ? length : MAX_CONTACTS;
            for (int i = 0; i < limit; ++i) {
                const Contact *c = &contacts[i];
                Position p = c->normalized.position;
                if ((c->state == 3 || c->state == 4) && isfinite(p.x) && isfinite(p.y)
                    && p.x >= -0.25f && p.x <= 1.25f && p.y >= -0.25f && p.y <= 1.25f) {
                    parsed[n++] = (PadPoint){ c->path, clamp01(p.x), clamp01(1.0f - p.y) };
                }
            }
        }
        if (n > 0) {
            active_sender = sender;
            memcpy(points, parsed, (size_t)n * sizeof(PadPoint));
            count = n;
            last_touch = centroid_of(points, n);
            touch_until = 0;
        } else if (sender == active_sender || active_sender == NULL) {
            int previous = count;
            count = 0;
            if (previous > 0) touch_until = millis() + 140; // tap-to-click can follow lift
        }
    }
    pthread_mutex_unlock(&mutex);
    return 0; // Observe only; preserve system gestures.
}

static bool bind_device(CFTypeRef candidate) {
    if (!candidate) return false;
    pthread_mutex_lock(&mutex);
    if (device_count >= MAX_DEVICES) {
        pthread_mutex_unlock(&mutex);
        return false;
    }
    int slot = device_count++;
    active_devices[slot] = candidate;
    pthread_mutex_unlock(&mutex);

    register_frame(candidate, on_frame);
    int result = start_device(candidate, 0);
    if (result == 0) return true;

    unregister_frame(candidate, on_frame);
    pthread_mutex_lock(&mutex);
    for (int i = 0; i < device_count; ++i) {
        if (active_devices[i] == candidate) {
            active_devices[i] = active_devices[--device_count];
            break;
        }
    }
    pthread_mutex_unlock(&mutex);
    return false;
}

int kc_pad_start(void) {
    if (!load_framework()) return -1;
    if (device_count > 0) return 0;

    pthread_mutex_lock(&mutex);
    device_count = 0;
    active_sender = NULL;
    count = 0;
    touch_until = 0;
    accepting = true;
    pthread_mutex_unlock(&mutex);

    if (mt_list) {
        devices = mt_list();
        if (devices) {
            CFIndex total = CFArrayGetCount(devices);
            for (CFIndex i = 0; i < total && device_count < MAX_DEVICES; ++i) {
                CFTypeRef candidate = CFArrayGetValueAtIndex(devices, i);
                if (!is_trackpad_device(candidate)) continue;
                bind_device(candidate);
            }
        }
    }

    if (device_count == 0 && mt_default) {
        default_device = mt_default();
        if (default_device && is_trackpad_device(default_device)) {
            bind_device(default_device);
        }
    }

    if (device_count > 0) return 0;

    pthread_mutex_lock(&mutex);
    accepting = false;
    count = 0;
    touch_until = 0;
    active_sender = NULL;
    pthread_mutex_unlock(&mutex);

    if (devices) {
        CFRelease(devices);
        devices = NULL;
    }
    if (default_device) {
        CFRelease(default_device);
        default_device = NULL;
    }
    return -1;
}

void kc_pad_stop(void) {
    CFTypeRef local[MAX_DEVICES];
    int n = 0;

    pthread_mutex_lock(&mutex);
    accepting = false;
    n = device_count;
    if (n > MAX_DEVICES) n = MAX_DEVICES;
    for (int i = 0; i < n; ++i) local[i] = active_devices[i];
    device_count = 0;
    active_sender = NULL;
    count = 0;
    touch_until = 0;
    pthread_mutex_unlock(&mutex);

    if (n > 0) {
        // Unregister first and pause briefly so in-flight MultitouchSupport frames finish safely (macOS 14+/15+).
        for (int i = 0; i < n; ++i) unregister_frame(local[i], on_frame);
        usleep(20000);
        for (int i = 0; i < n; ++i) stop_device(local[i]);
    }
    if (devices) {
        CFRelease(devices);
        devices = NULL;
    }
    if (default_device) {
        CFRelease(default_device);
        default_device = NULL;
    }
}

int kc_pad_device_count(void) {
    if (!load_framework() || !mt_list) return -1;
    CFArrayRef arr = mt_list();
    if (!arr) return 0;
    int eligible = 0;
    CFIndex total = CFArrayGetCount(arr);
    for (CFIndex i = 0; i < total && eligible < MAX_DEVICES; ++i) {
        if (is_trackpad_device(CFArrayGetValueAtIndex(arr, i))) ++eligible;
    }
    CFRelease(arr);
    return eligible;
}

int kc_pad_snapshot(PadPoint *out) {
    pthread_mutex_lock(&mutex);
    int n = count;
    if (n > 0) memcpy(out, points, (size_t)n * sizeof(*out));
    pthread_mutex_unlock(&mutex);
    return n;
}

bool kc_pad_click(PadPoint *out) {
    pthread_mutex_lock(&mutex);
    bool found = accepting && (count > 0 || touch_until > millis());
    if (found) *out = (count > 0) ? centroid_of(points, count) : last_touch;
    pthread_mutex_unlock(&mutex);
    return found;
}
