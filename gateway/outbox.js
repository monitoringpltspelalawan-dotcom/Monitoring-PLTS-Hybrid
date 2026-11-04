import fs from 'node:fs';
import path from 'node:path';

export class DiskOutbox {
  constructor(filePath, { maxBatches = 10000 } = {}) {
    this.filePath = path.resolve(filePath);
    this.maxBatches = maxBatches;
    this.state = { nextSeq: 1, pending: [] };
    this.load();
  }

  load() {
    if (!fs.existsSync(this.filePath)) return;
    let state;
    try {
      state = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch (err) {
      throw new Error(`Unable to read gateway outbox ${this.filePath}: ${err.message}`);
    }
    if (!state || !Number.isSafeInteger(state.nextSeq) || state.nextSeq < 1 || !Array.isArray(state.pending)) {
      throw new Error(`Gateway outbox ${this.filePath} has an invalid format`);
    }
    if (state.pending.some((item) => !Number.isSafeInteger(item.seq) || !Array.isArray(item.measurements))) {
      throw new Error(`Gateway outbox ${this.filePath} contains an invalid telemetry batch`);
    }
    this.state = state;
  }

  persist() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(tempPath, JSON.stringify(this.state), { flag: 'wx', mode: 0o600 });
      fs.renameSync(tempPath, this.filePath);
    } catch (err) {
      try { fs.rmSync(tempPath, { force: true }); } catch {}
      throw new Error(`Unable to persist gateway outbox ${this.filePath}: ${err.message}`);
    }
  }

  enqueue({ siteId, ts = new Date().toISOString(), measurements }) {
    if (!Array.isArray(measurements)) throw new Error('Outbox measurements must be an array');
    if (this.state.pending.length >= this.maxBatches) throw new Error(`Gateway outbox is full (${this.maxBatches} batches); refusing to discard telemetry`);
    const previous = this.state;
    const batch = { siteId, seq: this.state.nextSeq, ts, measurements };
    this.state = { nextSeq: this.state.nextSeq + 1, pending: [...this.state.pending, batch] };
    try {
      this.persist();
    } catch (err) {
      this.state = previous;
      throw err;
    }
    return batch;
  }

  peek() {
    return this.state.pending[0] || null;
  }

  acknowledge(seq) {
    const first = this.peek();
    if (!first || first.seq !== seq) throw new Error('Outbox acknowledgments must be in sequence order');
    const previous = this.state;
    this.state = { ...this.state, pending: this.state.pending.slice(1) };
    try {
      this.persist();
    } catch (err) {
      this.state = previous;
      throw err;
    }
  }

  get size() {
    return this.state.pending.length;
  }
}
