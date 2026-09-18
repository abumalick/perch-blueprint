// Service managers (launchd on macOS, sometimes systemd) start the agent with no locale
// in the environment. tmux decides from the attach client's locale whether the terminal
// can display Unicode: in a C locale it substitutes `_` for every non-ASCII cell, which
// blanks Arabic/accents in the streamed terminal. The tmux clients and every session
// program inherit the agent's env, so fixing it here at startup covers both.
const UTF8 = /utf-?8/i;

export function ensureUtf8Locale(env: Record<string, string | undefined>): void {
  // libc precedence: LC_ALL > LC_CTYPE > LANG — check the var that actually wins.
  const effective = env.LC_ALL ?? env.LC_CTYPE ?? env.LANG;
  if (effective !== undefined && UTF8.test(effective)) return;
  // A non-UTF-8 LC_ALL/LC_CTYPE would keep overriding the LANG fallback; drop them.
  if (env.LC_ALL !== undefined) delete env.LC_ALL;
  if (env.LC_CTYPE !== undefined) delete env.LC_CTYPE;
  env.LANG = 'en_US.UTF-8';
}
