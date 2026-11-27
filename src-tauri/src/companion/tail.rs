//! Bounded, read-only tailing. Never repairs or writes a source log.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::Path,
};

const READ_BUDGET: usize = 128 * 1024;
// Compacted DSH histories may contain a whole ~24 MiB log in one frame.
// Keep a finite cap while allowing those valid histories to bootstrap.
const MAX_FRAME: usize = 64 * 1024 * 1024;
const MAX_LINE: usize = 16 * 1024 * 1024;

pub fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct Position {
    pub offset: u64,
    pub identity: String,
    pub boundary_hash: String,
}

pub struct Tail {
    pub position: Position,
    pending: Vec<u8>,
    lines: Vec<u8>,
    compressed: bool,
}

pub struct Batch {
    pub records: Vec<serde_json::Value>,
    pub reset: bool,
    pub caught_up: bool,
}

fn identity(meta: &std::fs::Metadata) -> String {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        format!("{}:{}", meta.dev(), meta.ino())
    }
    #[cfg(not(unix))]
    {
        format!("{:?}", meta.created().ok())
    }
}

fn boundary(file: &mut File, offset: u64) -> Result<String, String> {
    file.seek(SeekFrom::Start(offset.saturating_sub(128)))
        .map_err(|_| "read".to_string())?;
    let mut b = vec![0; offset.min(128) as usize];
    file.read_exact(&mut b).map_err(|_| "read".to_string())?;
    Ok(digest(&b))
}

impl Tail {
    pub fn new(compressed: bool, position: Position) -> Self {
        Self {
            position,
            pending: vec![],
            lines: vec![],
            compressed,
        }
    }
    pub fn clean(&self) -> bool {
        self.pending.is_empty() && self.lines.is_empty()
    }
    pub fn read(&mut self, path: &Path) -> Result<Batch, String> {
        let mut file = File::open(path).map_err(|e| {
            if e.kind() == std::io::ErrorKind::PermissionDenied {
                "permission"
            } else {
                "unavailable"
            }
            .to_string()
        })?;
        let meta = file.metadata().map_err(|_| "read".to_string())?;
        let id = identity(&meta);
        let mut reset = false;
        if !self.position.identity.is_empty()
            && (self.position.identity != id
                || meta.len() < self.position.offset
                || boundary(&mut file, self.position.offset).ok().as_deref()
                    != Some(&self.position.boundary_hash))
        {
            self.position = Position::default();
            self.pending.clear();
            self.lines.clear();
            reset = true;
        }
        self.position.identity = id;
        file.seek(SeekFrom::Start(self.position.offset))
            .map_err(|_| "read".to_string())?;
        let mut raw = vec![0; READ_BUDGET];
        let n = file.read(&mut raw).map_err(|_| "read".to_string())?;
        raw.truncate(n);
        self.position.offset += n as u64;
        self.position.boundary_hash = boundary(&mut file, self.position.offset)?;
        if self.compressed {
            self.pending.extend(raw);
            if self.pending.len() > MAX_FRAME {
                return Err("limit".into());
            }
            let mut used = 0;
            while used < self.pending.len() {
                let bytes = &self.pending[used..];
                let size = match zstd::zstd_safe::find_frame_compressed_size(bytes) {
                    Ok(n) => n,
                    Err(code)
                        if zstd::zstd_safe::get_error_name(code) == "Src size is incorrect" =>
                    {
                        break
                    }
                    Err(_) => return Err("format".into()),
                };
                let decoder = zstd::stream::read::Decoder::new(&bytes[..size])
                    .map_err(|_| "format".to_string())?;
                let mut output = Vec::new();
                decoder
                    .take((MAX_FRAME + 1) as u64)
                    .read_to_end(&mut output)
                    .map_err(|_| "format".to_string())?;
                if output.len() > MAX_FRAME {
                    return Err("limit".into());
                }
                self.lines.extend(output);
                used += size;
                if self.lines.len() > MAX_FRAME * 2 {
                    return Err("limit".into());
                }
            }
            self.pending.drain(..used);
        } else {
            self.lines.extend(raw);
        }
        let mut records = vec![];
        let mut start = 0;
        for (i, byte) in self.lines.iter().enumerate() {
            if *byte != b'\n' {
                continue;
            }
            let line = &self.lines[start..i];
            start = i + 1;
            if line.len() > MAX_LINE {
                return Err("limit".into());
            }
            if line.is_empty() {
                continue;
            }
            let value: serde_json::Value =
                serde_json::from_slice(line).map_err(|_| "format".to_string())?;
            if !value.is_object() {
                return Err("format".into());
            }
            records.push(value);
        }
        self.lines.drain(..start);
        if self.lines.len() > MAX_LINE {
            return Err("limit".into());
        }
        Ok(Batch {
            records,
            reset,
            caught_up: self.position.offset >= meta.len(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    fn path() -> std::path::PathBuf {
        static ID: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        std::env::temp_dir().join(format!(
            "kuro-work-tail-{}-{}",
            std::process::id(),
            ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ))
    }
    #[test]
    fn half_line_and_rotation() {
        let p = path();
        std::fs::write(&p, b"{\"a\":").unwrap();
        let mut t = Tail::new(false, Position::default());
        assert!(t.read(&p).unwrap().records.is_empty());
        File::options()
            .append(true)
            .open(&p)
            .unwrap()
            .write_all(b"1}\n")
            .unwrap();
        assert_eq!(t.read(&p).unwrap().records.len(), 1);
        assert!(t.read(&p).unwrap().records.is_empty());
        std::fs::write(&p, b"{}\n").unwrap();
        assert!(t.read(&p).unwrap().reset);
        std::fs::remove_file(p).unwrap();
    }
    #[test]
    fn zstd_partial_and_checkpoint() {
        let p = path();
        let frame = zstd::stream::encode_all(&b"{\"a\":1}\n"[..], 1).unwrap();
        std::fs::write(&p, &frame[..frame.len() / 2]).unwrap();
        let mut t = Tail::new(true, Position::default());
        assert!(t.read(&p).unwrap().records.is_empty());
        assert!(!t.clean());
        File::options()
            .append(true)
            .open(&p)
            .unwrap()
            .write_all(&frame[frame.len() / 2..])
            .unwrap();
        assert_eq!(t.read(&p).unwrap().records.len(), 1);
        assert!(t.clean());
        let mut restarted = Tail::new(true, t.position.clone());
        assert!(restarted.read(&p).unwrap().records.is_empty());
        std::fs::remove_file(p).unwrap();
    }
    #[test]
    fn rewritten_boundary_resets_even_at_same_size() {
        let p = path();
        std::fs::write(&p, b"{\"a\":1}\n").unwrap();
        let mut t = Tail::new(false, Position::default());
        t.read(&p).unwrap();
        std::fs::write(&p, b"{\"a\":2}\n").unwrap();
        let batch = t.read(&p).unwrap();
        assert!(batch.reset);
        assert_eq!(batch.records[0]["a"], 2);
        std::fs::remove_file(p).unwrap();
    }
}
