export type TerminalInputHandle = {
  paste?: (text: string) => void;
  _core?: {
    coreService?: {
      triggerDataEvent?: (text: string, wasUserInput?: boolean) => void;
    };
  };
};

function getTerminalDataEventTrigger(term: TerminalInputHandle) {
  const coreService = term._core?.coreService;
  const triggerDataEvent = coreService?.triggerDataEvent;
  if (typeof triggerDataEvent !== 'function') {
    return null;
  }
  return (text: string, wasUserInput?: boolean) => {
    triggerDataEvent.call(coreService, text, wasUserInput);
  };
}

export function sendTerminalInput(
  term: TerminalInputHandle,
  text: string,
): boolean {
  if (typeof term.paste === 'function') {
    term.paste(text);
    return true;
  }

  const triggerDataEvent = getTerminalDataEventTrigger(term);
  if (!triggerDataEvent) {
    return false;
  }

  triggerDataEvent(text, true);
  return true;
}

export function sendTerminalDataEvent(
  term: TerminalInputHandle,
  text: string,
): boolean {
  const triggerDataEvent = getTerminalDataEventTrigger(term);
  if (!triggerDataEvent) {
    return false;
  }

  triggerDataEvent(text, true);
  return true;
}

export function submitTerminalBootstrapCommand(
  term: TerminalInputHandle,
  command: string,
  sendEnter: () => boolean,
): boolean {
  // Avoid bracketed-paste semantics when submitting the final Enter key.
  if (sendTerminalDataEvent(term, `${command}\r`)) {
    return true;
  }

  if (!sendTerminalInput(term, command)) {
    return sendEnter();
  }

  return sendEnter();
}
