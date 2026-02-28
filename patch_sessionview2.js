const fs = require('fs');
let code = fs.readFileSync('src/components/SessionView.tsx', 'utf8');

const search = `                            if (event.type === 'keydown' && event.metaKey && (event.key === 'Backspace' || event.key === 'Delete')) {
                                term.paste('\\x15');
                                return false;
                            }`;

const replace = `                            if (event.type === 'keydown' && event.metaKey && (event.key === 'Backspace' || event.key === 'Delete')) {
                                const coreService = term._core?.coreService;
                                if (coreService && typeof coreService.triggerDataEvent === 'function') {
                                    coreService.triggerDataEvent('\\x15', true);
                                } else {
                                    const textarea = iframe.contentDocument?.querySelector("textarea.xterm-helper-textarea");
                                    if (textarea) {
                                        textarea.dispatchEvent(new KeyboardEvent('keydown', {
                                            bubbles: true,
                                            cancelable: true,
                                            key: 'u',
                                            keyCode: 85,
                                            ctrlKey: true,
                                            view: win
                                        }));
                                    } else {
                                        term.paste('\\x15');
                                    }
                                }
                                return false;
                            }`;

// Replace all occurrences
code = code.split(search).join(replace);
fs.writeFileSync('src/components/SessionView.tsx', code);
