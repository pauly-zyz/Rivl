export default function BlockedPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16" data-testid="region-blocked">
      <span className="text-2xl font-black tracking-tight">
        Rivl<span className="text-red">.</span>
      </span>
      <h1 className="mt-10 text-3xl font-black tracking-tight">Not available in your region</h1>
      <p className="mt-4 text-muted">
        Rivl is not offered in your country or region. You can&apos;t create or join duels from here.
      </p>
      <p className="mt-4 text-sm text-faint">
        If you already have funds in a duel, they remain in the smart contract and can be withdrawn directly on chain
        with the <code className="text-muted">withdraw</code> function.
      </p>
    </main>
  );
}
