export default function SelfHost() {
  return (
    <main className="min-h-screen bg-set-bg text-set-text px-6 py-12">
      <div className="mx-auto max-w-2xl space-y-6">
        <a href="/" className="underline">Back to SET</a>
        <h1 className="text-3xl font-semibold">Self-host SET</h1>
        <p>This website does not offer public accounts. Run your own copy to use SET with your own data and AI connections.</p>
        <h2 className="text-xl font-semibold">Start on your own computer</h2>
        <p>Install Git and Docker with Docker Compose, then run:</p>
        <pre className="overflow-x-auto border border-set-border p-4 text-sm"><code>{`git clone https://github.com/GucciGross/SETv2
cd SETv2
cp .env.example .env
docker compose up -d`}</code></pre>
        <p>Open <code>http://localhost:8080/login</code> and create your account on your own installation.</p>
        <p>These are development defaults, not a safe public-internet setup. Before exposing it publicly, configure strong secrets, HTTPS, and the public self-hosted deployment settings in the documentation.</p>
        <a className="inline-block underline" href="https://github.com/GucciGross/SETv2#readme" target="_blank" rel="noreferrer">Read the installation documentation</a>
      </div>
    </main>
  );
}
