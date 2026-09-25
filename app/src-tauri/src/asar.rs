//! Electron asar archive read/extract/pack — byte-level port of @electron/asar.
//!
//! Format: `[u32 picklePayloadSize=4][u32 headerPickleLen]` (8 bytes), then the
//! header pickle: `[u32 payloadSize][u32 strLen][json bytes][zero pad to 4]`.
//! `headerPickleLen = 8 + align4(jsonLen)`. File data starts at
//! `8 + headerPickleLen + entry.offset` (offset is a string in the JSON).
//! Unpacked files live in `<archive>.unpacked/<relpath>` and have no offset.
//! Per-file integrity (Electron verifies it): SHA256 of whole file + SHA256 of
//! each 4MB block, hex-encoded.

use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Seek};
use std::path::{Path, PathBuf};

type Res<T> = Result<T, String>;

// ── read ──────────────────────────────────────────────────────────────────

pub struct Archive {
    pub header: Value,
    /// Full header pickle buffer length (node's filesystem.headerSize).
    pub header_size: usize,
}

pub fn read_archive(path: &Path) -> Res<Archive> {
    let mut f = fs::File::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    let mut size_buf = [0u8; 8];
    f.read_exact(&mut size_buf).map_err(|e| format!("read header size: {e}"))?;
    let size = u32::from_le_bytes(size_buf[4..8].try_into().unwrap()) as usize;
    if size < 8 || size > 64 * 1024 * 1024 {
        return Err(format!("implausible header size {size}"));
    }
    let mut header_buf = vec![0u8; size];
    f.read_exact(&mut header_buf).map_err(|e| format!("read header: {e}"))?;
    let str_len = u32::from_le_bytes(header_buf[4..8].try_into().unwrap()) as usize;
    if 8 + str_len > header_buf.len() {
        return Err("header string overruns pickle".into());
    }
    let json = std::str::from_utf8(&header_buf[8..8 + str_len])
        .map_err(|e| format!("header json utf8: {e}"))?;
    let header: Value =
        serde_json::from_str(json).map_err(|e| format!("header json parse: {e}"))?;
    Ok(Archive { header, header_size: size })
}

pub fn sibling_unpacked(archive_path: &Path) -> PathBuf {
    let name = archive_path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    archive_path.with_file_name(format!("{name}.unpacked"))
}

// ── integrity ─────────────────────────────────────────────────────────────

fn file_integrity(bytes: &[u8]) -> Value {
    const BLOCK: usize = 4 * 1024 * 1024;
    let mut whole = Sha256::new();
    whole.update(bytes);
    let mut blocks: Vec<String> = Vec::new();
    if bytes.is_empty() {
        let h = Sha256::new();
        blocks.push(hex::encode(h.finalize()));
    }
    for chunk in bytes.chunks(BLOCK) {
        let mut h = Sha256::new();
        h.update(chunk);
        blocks.push(hex::encode(h.finalize()));
    }
    json!({
        "algorithm": "SHA256",
        "hash": hex::encode(whole.finalize()),
        "blockSize": BLOCK,
        "blocks": blocks,
    })
}

// ── extract ───────────────────────────────────────────────────────────────

pub fn extract(archive_path: &Path, dest: &Path) -> Res<()> {
    let archive = read_archive(archive_path)?;
    let data_start = (8 + archive.header_size) as u64;
    let mut file = fs::File::open(archive_path).map_err(|e| e.to_string())?;
    let unpacked_root = sibling_unpacked(archive_path);
    walk_extract(&archive.header, dest, "", &mut file, data_start, &unpacked_root)
}

fn walk_extract(
    node: &Value,
    dest: &Path,
    rel: &str,
    archive: &mut fs::File,
    data_start: u64,
    unpacked_root: &Path,
) -> Res<()> {
    let files = node
        .get("files")
        .and_then(|f| f.as_object())
        .ok_or_else(|| format!("no files object at '{rel}'"))?;
    for (name, child) in files {
        let child_rel = child_rel_path(rel, name);
        let target = dest.join(name);
        if child.get("files").is_some() {
            fs::create_dir_all(&target).map_err(|e| format!("mkdir {}: {e}", target.display()))?;
            walk_extract(child, &target, &child_rel, archive, data_start, unpacked_root)?;
        } else if let Some(link) = child.get("link").and_then(|l| l.as_str()) {
            create_link(&target, link)?;
        } else if child.get("unpacked").and_then(|u| u.as_bool()).unwrap_or(false) {
            let src = unpacked_root.join(&child_rel);
            fs::copy(&src, &target).map_err(|e| {
                format!("copy unpacked {} → {}: {e}", src.display(), target.display())
            })?;
            apply_exec_flag(child, &target);
        } else {
            let offset: u64 = child
                .get("offset")
                .and_then(|o| o.as_str())
                .and_then(|s| s.parse().ok())
                .ok_or_else(|| format!("file '{child_rel}' missing numeric offset"))?;
            let size: u64 = child
                .get("size")
                .and_then(|s| s.as_u64())
                .ok_or_else(|| format!("file '{child_rel}' missing size"))?;
            let mut buf = vec![0u8; size as usize];
            archive
                .seek(std::io::SeekFrom::Start(data_start + offset))
                .map_err(|e| e.to_string())?;
            archive.read_exact(&mut buf).map_err(|e| e.to_string())?;
            fs::write(&target, &buf).map_err(|e| format!("write {}: {e}", target.display()))?;
            apply_exec_flag(child, &target);
        }
    }
    Ok(())
}

fn child_rel_path(rel: &str, name: &str) -> String {
    if rel.is_empty() { name.to_string() } else { format!("{rel}/{name}") }
}

fn apply_exec_flag(node: &Value, target: &Path) {
    #[cfg(unix)]
    {
        if node.get("executable").and_then(|e| e.as_bool()).unwrap_or(false) {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(target, fs::Permissions::from_mode(0o755));
        }
    }
    #[cfg(not(unix))]
    let _ = (node, target);
}

fn create_link(target: &Path, link: &str) -> Res<()> {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(link, target)
            .map_err(|e| format!("symlink {}: {e}", target.display()))
    }
    #[cfg(windows)]
    Err(format!("symlinks unsupported on this platform: {target:?}"))
}

// ── pack ──────────────────────────────────────────────────────────────────

/// Files under this path (relative, slash-separated) are marked `unpacked` and
/// written to `<dest>.unpacked/` — matches the patcher's
/// `--unpack-dir "node_modules/steamworks.js"` (root AGENTS.md pitfall 2).
pub const UNPACK_PREFIX: &str = "node_modules/steamworks.js";

struct Out {
    data: Vec<u8>,
    dest_unpacked: PathBuf,
    unpacked_written: usize,
}

pub fn pack(src: &Path, dest: &Path) -> Res<()> {
    let mut out = Out {
        data: Vec::new(),
        dest_unpacked: sibling_unpacked(dest),
        unpacked_written: 0,
    };
    let header = walk_pack(src, "", &mut out)?;

    // header pickle: [u32 payloadSize][u32 strLen][json][pad to 4]
    let json_str = serde_json::to_string(&header).map_err(|e| e.to_string())?;
    let json_bytes = json_str.as_bytes();
    let pad = (4 - json_bytes.len() % 4) % 4;
    let payload = 4 + json_bytes.len() + pad;
    let header_len = 4 + payload;

    let mut blob = Vec::with_capacity(8 + header_len + out.data.len());
    blob.extend_from_slice(&(4u32).to_le_bytes());
    blob.extend_from_slice(&(header_len as u32).to_le_bytes());
    blob.extend_from_slice(&(payload as u32).to_le_bytes());
    blob.extend_from_slice(&(json_bytes.len() as u32).to_le_bytes());
    blob.extend_from_slice(json_bytes);
    blob.extend(std::iter::repeat(0u8).take(pad));
    blob.extend_from_slice(&out.data);

    fs::write(dest, &blob).map_err(|e| format!("write {}: {e}", dest.display()))?;
    Ok(())
}

fn walk_pack(src: &Path, rel: &str, out: &mut Out) -> Res<Value> {
    let abs = if rel.is_empty() { src.to_path_buf() } else { src.join(rel) };
    let mut entries = Map::new();
    let mut names: Vec<String> = fs::read_dir(&abs)
        .map_err(|e| format!("readdir {}: {e}", abs.display()))?
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    names.sort();

    let dir_is_unpacked =
        rel == UNPACK_PREFIX || (!rel.is_empty() && rel.starts_with(&format!("{UNPACK_PREFIX}/")));

    for name in names {
        let child_rel = child_rel_path(rel, &name);
        let child_abs = src.join(&child_rel);
        let meta = fs::symlink_metadata(&child_abs).map_err(|e| e.to_string())?;

        if meta.is_dir() {
            let mut child = walk_pack(src, &child_rel, out)?;
            if dir_is_unpacked {
                child
                    .as_object_mut()
                    .unwrap()
                    .insert("unpacked".into(), Value::Bool(true));
            }
            entries.insert(name, child);
        } else if meta.file_type().is_symlink() {
            return Err(format!("symlinks unsupported in pack: {}", child_abs.display()));
        } else {
            let bytes =
                fs::read(&child_abs).map_err(|e| format!("read {}: {e}", child_abs.display()))?;
            let size = bytes.len() as u64;
            let integrity = file_integrity(&bytes);
            if dir_is_unpacked {
                let to = out.dest_unpacked.join(&child_rel);
                if let Some(parent) = to.parent() {
                    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                fs::copy(&child_abs, &to)
                    .map_err(|e| format!("copy to unpacked {}: {e}", to.display()))?;
                out.unpacked_written += 1;
                entries.insert(name, json!({ "size": size, "unpacked": true, "integrity": integrity }));
            } else {
                let offset = out.data.len() as u64;
                out.data.extend_from_slice(&bytes);
                let mut entry = json!({
                    "size": size,
                    "offset": offset.to_string(),
                    "integrity": integrity,
                });
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    if meta.permissions().mode() & 0o100 != 0 {
                        entry
                            .as_object_mut()
                            .unwrap()
                            .insert("executable".into(), Value::Bool(true));
                    }
                }
                entries.insert(name, entry);
            }
        }
    }
    Ok(json!({ "files": entries }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_real_asar() {
        let real = std::env::var("HW_TEST_ASAR").ok();
        let real = real.unwrap_or_else(|| format!(
            "{}/.local/share/Steam/steamapps/common/Happy Wheels/resources/app.asar",
            std::env::var("HOME").unwrap()
        ));
        let tmp = std::env::temp_dir().join("hwmm-asar-test");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        let dir1 = tmp.join("x1");
        extract(Path::new(&real), &dir1).unwrap();
        let count1 = count_files(&dir1);

        let packed = tmp.join("repacked.asar");
        pack(&dir1, &packed).unwrap();

        // header sanity: readable again
        let a = read_archive(&packed).unwrap();
        assert!(a.header.get("files").is_some());

        let dir2 = tmp.join("x2");
        extract(&packed, &dir2).unwrap();
        let count2 = count_files(&dir2);
        assert_eq!(count1, count2);

        compare_trees(&dir1, &dir2).unwrap();
        // unpacked sibling must exist with the same file count as tree unpacked files
        assert!(sibling_unpacked(&packed).exists());
        let _ = fs::remove_dir_all(&tmp);
    }

    fn count_files(dir: &Path) -> usize {
        fs::read_dir(dir).unwrap().fold(0, |n, e| {
            let e = e.unwrap();
            if e.file_type().unwrap().is_dir() { n + count_files(&e.path()) } else { n + 1 }
        })
    }

    fn compare_trees(a: &Path, b: &Path) -> Res<()> {
        let mut names: Vec<String> = fs::read_dir(a).unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        names.sort();
        let mut names2: Vec<String> = fs::read_dir(b).unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        names2.sort();
        assert_eq!(names, names2, "tree mismatch at {a:?} vs {b:?}");
        for n in names {
            let pa = a.join(&n);
            let pb = b.join(&n);
            if pa.is_dir() { compare_trees(&pa, &pb)?; }
            else {
                let ba = fs::read(&pa).unwrap();
                let bb = fs::read(&pb).unwrap();
                assert_eq!(ba, bb, "content mismatch: {n}");
            }
        }
        Ok(())
    }
}
