const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const express = require('express');

/**
 * Stores media files in a local directory and serves them over HTTP.
 * Used for development; the S3 driver (Cloudflare R2 / Garage) implements
 * the same interface for deployment.
 */
class LocalStorage {
  constructor({ root, publicPath = '/media' }) {
    this.name = 'local';
    this.root = path.resolve(root);
    this.publicPath = publicPath.replace(/\/+$/, '');
    fs.mkdirSync(this.root, { recursive: true });
  }

  /** Converts a storage key (e.g. "videos/abc/master.m3u8") into a safe absolute path. */
  resolve(key) {
    const clean = String(key).replace(/\\/g, '/').replace(/^\/+/, '');
    const full = path.resolve(this.root, clean);
    if (full !== this.root && !full.startsWith(this.root + path.sep)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return full;
  }

  /** Saves a file from disk. With move=true the source file is moved instead of copied. */
  async putFile(key, sourcePath, { move = false } = {}) {
    const target = this.resolve(key);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    if (move) {
      try {
        await fsp.rename(sourcePath, target);
        return key;
      } catch (err) {
        if (err.code !== 'EXDEV') throw err; // different drive: fall back to copy + delete
      }
      await fsp.copyFile(sourcePath, target);
      await fsp.unlink(sourcePath).catch(() => {});
      return key;
    }
    await fsp.copyFile(sourcePath, target);
    return key;
  }

  async putBuffer(key, buffer) {
    const target = this.resolve(key);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, buffer);
    return key;
  }

  async delete(key) {
    if (!key) return;
    await fsp.rm(this.resolve(key), { force: true });
  }

  /** Deletes every object whose key starts with the prefix (a "folder"). */
  async deletePrefix(prefix) {
    if (!prefix) return;
    await fsp.rm(this.resolve(prefix), { recursive: true, force: true });
  }

  getUrl(key) {
    const encoded = String(key).split('/').map(encodeURIComponent).join('/');
    return `${this.publicPath}/${encoded}`;
  }

  /** Returns the storage key for a URL produced by getUrl(), or null for foreign URLs. */
  keyFromUrl(url) {
    if (!url || !url.startsWith(this.publicPath + '/')) return null;
    return decodeURIComponent(url.slice(this.publicPath.length + 1));
  }

  /** Express middleware serving the stored files (supports Range requests for video seeking). */
  middleware() {
    return express.static(this.root, {
      fallthrough: false,
      index: false,
      dotfiles: 'deny',
      maxAge: '1h',
    });
  }
}

module.exports = LocalStorage;
