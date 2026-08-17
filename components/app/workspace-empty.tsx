export function WorkspaceEmpty() {
  return <main className="workspace-empty-page">
    <section className="workspace-empty-card">
      <div className="brand-mark"><span>R</span><i /></div>
      <p className="eyebrow">Secure workspace</p>
      <h1>Connect the secure database</h1>
      <p>The client workbook has been audited and the demonstration records have been removed. Configure Supabase, apply the migrations, and run the reviewed import before opening the live workspace.</p>
      <a className="primary-button" href="/login">Open staff sign in</a>
    </section>
  </main>;
}
