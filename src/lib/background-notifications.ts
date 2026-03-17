import * as childProcess from 'node:child_process';

type BackgroundNotificationInput = {
  sessionId: string;
  title: string;
  description: string;
};

type NotificationCommandAttempt = {
  command: string;
  args: string[];
};

function shellEscapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function toSessionUrl(sessionId: string): string | null {
  const appUrl = process.env.PALX_APP_URL?.trim();
  const normalizedSessionId = sessionId.trim();
  if (!appUrl || !normalizedSessionId) {
    return null;
  }

  try {
    const url = new URL(appUrl);
    url.pathname = `/session/${encodeURIComponent(normalizedSessionId)}`;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

export function getBackgroundNotificationAttempts(
  input: BackgroundNotificationInput,
): NotificationCommandAttempt[] {
  const title = input.title.trim();
  const description = input.description.trim();
  const sessionUrl = toSessionUrl(input.sessionId);

  if (!title || !description) {
    return [];
  }

  if (process.platform === 'darwin') {
    const attempts: NotificationCommandAttempt[] = [];
    if (sessionUrl) {
      attempts.push({
        command: 'terminal-notifier',
        args: [
          '-title',
          title,
          '-message',
          description,
          '-group',
          `palx-session-${input.sessionId.trim()}`,
          '-open',
          sessionUrl,
        ],
      });
    }

    attempts.push({
      command: 'osascript',
      args: [
        '-e',
        `display notification "${shellEscapeAppleScriptString(description)}" with title "${shellEscapeAppleScriptString(title)}"`,
      ],
    });
    return attempts;
  }

  if (process.platform === 'win32') {
    return [
      {
        command: 'powershell.exe',
        args: [
          '-NoProfile',
          '-Command',
          `[void][Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms');` +
            ` [void][System.Windows.Forms.MessageBox]::Show(${JSON.stringify(description)}, ${JSON.stringify(title)})`,
        ],
      },
    ];
  }

  return [
    {
      command: 'notify-send',
      args: [title, description],
    },
  ];
}

async function runAttempt(attempt: NotificationCommandAttempt): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = childProcess.spawn(attempt.command, attempt.args, {
      stdio: 'ignore',
      detached: false,
    });

    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${attempt.command} exited with code ${code ?? 'unknown'}`));
    });
  });
}

export async function sendBackgroundSessionNotification(
  input: BackgroundNotificationInput,
): Promise<boolean> {
  const attempts = getBackgroundNotificationAttempts(input);
  for (const attempt of attempts) {
    try {
      await runAttempt(attempt);
      return true;
    } catch {
      continue;
    }
  }

  return false;
}
