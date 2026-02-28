const fs = require('fs');
let code = fs.readFileSync('src/components/SessionView.tsx', 'utf8');
const searchAgent = `
                    // Set selection highlight color via xterm.js 5 theme API (canvas renderer)
`;
const replaceAgent = `
                    // Clear user input on Cmd+Delete
                    if (typeof term.attachCustomKeyEventHandler === 'function') {
                        const existingCustomKeyEventHandler = term.customKeyEventHandler;
                        term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
                            if (event.type === 'keydown' && event.metaKey && (event.key === 'Backspace' || event.key === 'Delete')) {
                                term.paste('\\x15');
                                return false;
                            }
                            if (typeof existingCustomKeyEventHandler === 'function') {
                                return existingCustomKeyEventHandler(event);
                            }
                            return true;
                        });
                    }

                    // Set selection highlight color via xterm.js 5 theme API (canvas renderer)
`;

code = code.replace(searchAgent, replaceAgent); // This replaces the first occurrence (agent terminal)
code = code.replace(searchAgent, replaceAgent); // This replaces the second occurrence (terminal)
fs.writeFileSync('src/components/SessionView.tsx', code);
