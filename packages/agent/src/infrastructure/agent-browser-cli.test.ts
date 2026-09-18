import { describe, it, expect, vi } from 'vitest';
import { AgentBrowserCli, execFileRunner } from './agent-browser-cli';

function makeRunner() {
  return vi.fn<(cmd: string, args: string[], env: Record<string, string>) => Promise<void>>(
    async () => undefined,
  );
}

describe('AgentBrowserCli', () => {
  // Perch runs every agent-browser command with an EMPTY env overlay. Imposing
  // AGENT_BROWSER_IDLE_TIMEOUT_MS would change the session's config hash, and agent-browser
  // relaunches the browser (dropping the current page + stream) whenever a command's config
  // differs from how the session was created — which nukes agent-created sessions the moment
  // Perch steers them. Staying env-less keeps Perch consistent with those sessions.
  it('start opens about:blank without imposing an idle-timeout env, then sets a phone viewport', async () => {
    const run = makeRunner();
    const cli = new AgentBrowserCli(run);

    await cli.start('ws1');

    expect(run).toHaveBeenCalledTimes(2);
    const [cmd, args, env] = run.mock.calls[0]!;
    expect(cmd).toBe('agent-browser');
    expect(args).toEqual(['--session', 'ws1', 'open', 'about:blank']);
    expect(env).toEqual({});
    // Phone-sized viewport → ~1:1 canvas scale on the phone, so taps land precisely.
    expect(run.mock.calls[1]![1]).toEqual(['--session', 'ws1', 'set', 'viewport', '390', '700']);
  });

  it('start still succeeds when the viewport step fails', async () => {
    const run = makeRunner().mockImplementation(async (_cmd, args) => {
      if (args.includes('viewport')) throw new Error('unsupported');
    });
    const cli = new AgentBrowserCli(run);

    await expect(cli.start('ws1')).resolves.toBeUndefined();
  });

  it('navigate passes the URL as a single argv element', async () => {
    const run = makeRunner();
    const cli = new AgentBrowserCli(run);

    await cli.navigate('ws1', 'https://example.com/a b?q=1&r=2');

    expect(run).toHaveBeenCalledTimes(1);
    const [cmd, args, env] = run.mock.calls[0]!;
    expect(cmd).toBe('agent-browser');
    expect(args).toEqual(['--session', 'ws1', 'open', 'https://example.com/a b?q=1&r=2']);
    expect(env).toEqual({});
  });

  it('navigate accepts plain http URLs', async () => {
    const run = makeRunner();
    const cli = new AgentBrowserCli(run);

    await cli.navigate('ws1', 'http://127.0.0.1:8080/');

    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['back', ['--session', 'ws1', 'back']],
    ['forward', ['--session', 'ws1', 'forward']],
    ['stop', ['--session', 'ws1', 'close']],
  ] as const)('%s runs the matching CLI subcommand with no idle-timeout env', async (method, expectedArgs) => {
    const run = makeRunner();
    const cli = new AgentBrowserCli(run);

    await cli[method]('ws1');

    expect(run).toHaveBeenCalledTimes(1);
    const [cmd, args, env] = run.mock.calls[0]!;
    expect(cmd).toBe('agent-browser');
    expect(args).toEqual(expectedArgs);
    expect(env).toEqual({});
  });

  it('setViewport passes rounded dimensions with no idle-timeout env', async () => {
    const run = makeRunner();
    const cli = new AgentBrowserCli(run);

    await cli.setViewport('ws1', 390.4, 843.6);

    expect(run).toHaveBeenCalledTimes(1);
    const [cmd, args, env] = run.mock.calls[0]!;
    expect(cmd).toBe('agent-browser');
    expect(args).toEqual(['--session', 'ws1', 'set', 'viewport', '390', '844']);
    expect(env).toEqual({});
  });

  it.each([
    [100, 700, ['200', '700']],
    [390, 9000, ['390', '4096']],
  ])('setViewport clamps %d×%d into [200, 4096]', async (w, h, expected) => {
    const run = makeRunner();
    const cli = new AgentBrowserCli(run);

    await cli.setViewport('ws1', w, h);

    expect(run.mock.calls[0]![1]).toEqual(['--session', 'ws1', 'set', 'viewport', ...expected]);
  });

  it.each([
    [Number.NaN, 700],
    [390, Number.POSITIVE_INFINITY],
  ])('setViewport rejects non-finite dimensions %d×%d without invoking the runner', async (w, h) => {
    const run = makeRunner();
    const cli = new AgentBrowserCli(run);

    await expect(cli.setViewport('ws1', w, h)).rejects.toThrow(/finite/);
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    'file:///etc/passwd',
    'javascript:alert(1)',
    'ftp://example.com/x',
    'not a url',
    '',
    'example.com', // no scheme — does not parse as a URL
  ])('navigate rejects %j without invoking the runner', async (url) => {
    const run = makeRunner();
    const cli = new AgentBrowserCli(run);

    await expect(cli.navigate('ws1', url)).rejects.toThrow(/http/);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('execFileRunner', () => {
  it('extends process.env with the overlay (services need PATH for the mise shim)', async () => {
    // A child that exits non-zero unless it sees both the overlay var and an
    // inherited PATH — proving the overlay extends process.env, not replaces it.
    await expect(
      execFileRunner(
        'node',
        ['-e', 'process.exit(process.env.PERCH_TEST_OVERLAY === "1" && process.env.PATH ? 0 : 1)'],
        { PERCH_TEST_OVERLAY: '1' },
      ),
    ).resolves.toBeUndefined();
  });

  it('rejects when the command fails', async () => {
    await expect(execFileRunner('node', ['-e', 'process.exit(1)'], {})).rejects.toThrow();
  });
});
