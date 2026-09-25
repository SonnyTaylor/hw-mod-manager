//! Electron fuse handling — byte-level port of @electron/fuses (read/flip only).
//!
//! Wire layout in the binary: 32-byte ASCII sentinel `dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX`,
//! then 1 byte version (must be 1), 1 byte wire length, then one byte per fuse:
//! 48 ('0') = DISABLE, 49 ('1') = ENABLE, 114 ('r') = REMOVED, 144 = INHERIT.
//! Fuse index 4 = EnableEmbeddedAsarIntegrityValidation (the one that must be
//! off for a modified app.asar to boot — root AGENTS.md pitfall 1).

use std::fs;
use std::path::Path;

const SENTINEL: &[u8] = b"dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX";
pub const FUSE_ENABLE_EMBEDDED_ASAR_INTEGRITY_VALIDATION: usize = 4;

const DISABLE: u8 = 48;
const ENABLE: u8 = 49;

/// Read the state byte of `fuse_index` for each sentinel copy. Ok(vec) — one
/// entry per sentinel (1 normally, 2 on universal macOS builds).
#[allow(dead_code)]
pub fn read_fuse(exe: &Path, fuse_index: usize) -> Result<Vec<u8>, String> {
    let data = fs::read(exe).map_err(|e| format!("read {}: {e}", exe.display()))?;
    let positions = find_sentinels(&data)?;
    let mut states = Vec::new();
    for p in positions {
        let version = data[p + SENTINEL.len()];
        if version != 1 {
            return Err(format!("unexpected fuse wire version {version}"));
        }
        let length = data[p + SENTINEL.len() + 1] as usize;
        if fuse_index >= length {
            return Err(format!("fuse index {fuse_index} beyond wire length {length}"));
        }
        states.push(data[p + SENTINEL.len() + 2 + fuse_index]);
    }
    Ok(states)
}

/// Flip `fuse_index` to DISABLE in every sentinel copy. Returns false when it
/// was already disabled. Mirrors @electron/fuses semantics (0 copies / >2 copies = error).
pub fn set_fuse_disabled(exe: &Path, fuse_index: usize) -> Result<bool, String> {
    let mut data = fs::read(exe).map_err(|e| format!("read {}: {e}", exe.display()))?;
    let positions = find_sentinels(&data)?;
    let mut changed = false;
    for p in &positions {
        let version = data[*p + SENTINEL.len()];
        if version != 1 {
            return Err(format!("unexpected fuse wire version {version}"));
        }
        let length = data[*p + SENTINEL.len() + 1] as usize;
        if fuse_index >= length {
            return Err(format!("fuse index {fuse_index} beyond wire length {length}"));
        }
        let off = p + SENTINEL.len() + 2 + fuse_index;
        let cur = data[off];
        if cur == DISABLE {
            continue;
        }
        if cur != ENABLE {
            return Err(format!(
                "fuse {fuse_index} is in unexpected state {cur} (114=removed, 144=inherit)"
            ));
        }
        data[off] = DISABLE;
        changed = true;
    }
    if changed {
        fs::write(exe, &data).map_err(|e| format!("write {}: {e}", exe.display()))?;
    }
    Ok(!changed)
}

fn find_sentinels(data: &[u8]) -> Result<Vec<usize>, String> {
    let positions = find_all(data);
    match positions.len() {
        0 => Err("no fuse sentinel found — fuses are only supported in Electron 12+".into()),
        1 | 2 => Ok(positions),
        n => Err(format!("found {n} copies of the fuse sentinel — refusing to patch")),
    }
}

fn find_all(data: &[u8]) -> Vec<usize> {
    let mut out = Vec::new();
    let mut start = 0;
    while start + SENTINEL.len() <= data.len() {
        let rel = data[start..]
            .windows(SENTINEL.len())
            .position(|w| w == SENTINEL);
        match rel {
            Some(rel) => {
                let pos = start + rel;
                out.push(pos);
                start = pos + 1;
            }
            None => break,
        }
    }
    out
}
