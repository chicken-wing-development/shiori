class ExportJobs {
  private pending = new Set<Promise<unknown>>();
  private closing = false;
  get busy(): boolean { return this.pending.size > 0; }

  run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error('終了処理中です。保存が完了するまでお待ちください。'));
    // Invoke immediately: the web Save As picker needs the original user gesture.
    const job = operation();
    this.pending.add(job);
    void job.then(() => this.pending.delete(job), () => this.pending.delete(job));
    return job;
  }

  async shutdown(): Promise<boolean> {
    this.closing = true;
    return (await Promise.allSettled([...this.pending])).every(result => result.status === 'fulfilled');
  }
  resume(): void { this.closing = false; }
}

export const exportJobs = new ExportJobs();
