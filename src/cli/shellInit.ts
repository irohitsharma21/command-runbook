/**
 * Shell integration printed by `runbook shell-init`.
 *
 * This is what makes the CLI feel like the VS Code extension: `rbs` saves the
 * command you just ran (read from the shell's own history, which only the shell
 * itself can do reliably), and Ctrl-G inserts a saved command onto your prompt.
 *
 * The picker uses fzf when it is installed and falls back to a plain numbered
 * list when it is not, so the integration works on a bare machine.
 */

const BASH = `# Runbook shell integration — add to ~/.bashrc:
#   eval "$(runbook shell-init bash)"

# Save the command you just ran.
rbs() {
  local last
  last=$(HISTTIMEFORMAT= history 1 | sed -E 's/^[[:space:]]*[0-9]+[[:space:]]*//')
  [ -z "$last" ] && { echo "runbook: no previous command found" >&2; return 1; }
  runbook save "$last"
}

# Insert a saved command onto the prompt (Ctrl-G).
__runbook_pick() {
  local choice
  if command -v fzf >/dev/null 2>&1; then
    choice=$(runbook list --json 2>/dev/null \\
      | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{JSON.parse(s).forEach(c=>console.log(c.description+"\\t"+c.command))}catch(e){}})' \\
      | fzf --with-nth=1 --delimiter='\\t' --height=40% --reverse --prompt="runbook> ")
    choice=\${choice#*$'\\t'}
  else
    runbook list >&2
    read -r -p "runbook query: " q
    choice=$(runbook get "$q" 2>/dev/null)
  fi
  [ -n "$choice" ] && READLINE_LINE="$choice" && READLINE_POINT=\${#choice}
}
bind -x '"\\C-g": __runbook_pick' 2>/dev/null
`;

const ZSH = `# Runbook shell integration — add to ~/.zshrc:
#   eval "$(runbook shell-init zsh)"

# Save the command you just ran.
rbs() {
  local last=\${history[$((HISTCMD-1))]}
  [ -z "$last" ] && { echo "runbook: no previous command found" >&2; return 1; }
  runbook save "$last"
}

# Insert a saved command onto the prompt (Ctrl-G).
__runbook_pick() {
  local choice
  if command -v fzf >/dev/null 2>&1; then
    choice=$(runbook list --json 2>/dev/null \\
      | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{JSON.parse(s).forEach(c=>console.log(c.description+"\\t"+c.command))}catch(e){}})' \\
      | fzf --with-nth=1 --delimiter=$'\\t' --height=40% --reverse --prompt="runbook> ")
    choice=\${choice#*$'\\t'}
  else
    runbook list >&2
    read -r "q?runbook query: "
    choice=$(runbook get "$q" 2>/dev/null)
  fi
  [[ -n "$choice" ]] && LBUFFER="$choice"
  zle reset-prompt
}
zle -N __runbook_pick
bindkey '^G' __runbook_pick
`;

export const SHELL_INIT: Record<'bash' | 'zsh', string> = {
  bash: BASH,
  zsh: ZSH
};
