import { stdout } from "node:process";

export function printVersion(version: string): void {
  stdout.write(`${version}\n`);
}

export function printRequestedHelp(args: string[]): void {
  const topic = args[0];

  switch (topic) {
    case undefined:
      printRootHelp();
      return;
    case "launch":
      printLauncherHelp();
      return;
    case "doctor":
      printDoctorHelp();
      return;
    case "config":
      printConfigHelp();
      return;
    case "debug":
      printDebugHelp();
      return;
    case "completion":
      printCompletionHelp();
      return;
    case "uninstall":
      printUninstallHelp();
      return;
    case "claude":
      printClaudeHelp();
      return;
    case "opencode":
      printOpencodeHelp();
      return;
    case "internal":
      printInternalHelp();
      return;
    default:
      throw new Error(`Unknown help topic: ${topic}`);
  }
}

export async function runCompletionCommand(args: string[]): Promise<void> {
  const shell = args[0];
  if (!shell || shell === "--help" || shell === "-h") {
    printCompletionHelp();
    return;
  }

  switch (shell) {
    case "bash":
      stdout.write(buildBashCompletionScript());
      return;
    case "zsh":
      stdout.write(buildZshCompletionScript());
      return;
    case "fish":
      stdout.write(buildFishCompletionScript());
      return;
    default:
      throw new Error(`Unknown Aperture completion shell: ${shell}`);
  }
}

export function printRootHelp(): void {
  stdout.write(
    [
      "Aperture",
      "The live attention surface for humans working with agents.",
      "",
      "Usage:",
      "  aperture",
      "  aperture [options]",
      "  aperture <command> [options]",
      "",
      "Common flows:",
      "  aperture",
      "      Launch Aperture, connect Claude/OpenCode, and open the TUI.",
      "  aperture --capture",
      "      Launch Aperture and export a replayable capture on exit.",
      "  aperture doctor",
      "      Check runtime, Claude hooks, OpenCode profiles, and product state.",
      "  aperture config",
      "      Inspect APERTURE.md preferences, policy, diagnostics, and suggestions.",
      "  aperture debug",
      "      Print support details for runtime, hooks, OpenCode, and captures.",
      "  aperture --version",
      "      Print the installed Aperture version.",
      "  aperture uninstall --yes",
      "      Remove Aperture state and Claude hook entries before uninstalling the package.",
      "",
      "Commands:",
      "  help [topic]          Show help for Aperture or a specific topic",
      "  doctor                Print runtime, Claude, OpenCode, and state health",
      "  config                Inspect APERTURE.md and learned policy suggestions",
      "  debug [topic]         Print support details for troubleshooting",
      "  completion <shell>    Print a shell completion script",
      "  uninstall [--yes]     Remove Aperture-owned state and Claude hooks",
      "  claude                Manage Claude Code setup",
      "  opencode              Show the OpenCode setup flow Aperture expects",
      "  internal              Advanced runtime, TUI, adapter, and hook plumbing",
      "  version               Print the installed Aperture version",
      "",
      "Launcher options:",
      "  --learning <on|off>   Start a new runtime with learning on or off",
      "  --no-claude           Skip starting the Claude Code adapter",
      "  --no-opencode         Skip starting the OpenCode adapter",
      "  --capture             Export a troubleshooting capture when Aperture exits",
      "  --capture-out <path>  Write the captured bundle to an explicit path",
      "  --help, -h            Show this help text",
      "  --version, -v         Print the installed Aperture version",
      "",
      "Help topics:",
      "  aperture help launch",
      "  aperture help doctor",
      "  aperture help config",
      "  aperture help debug",
      "  aperture help completion",
      "  aperture help uninstall",
      "  aperture help claude",
      "  aperture help opencode",
      "  aperture help internal",
    ].join("\n"),
  );
  stdout.write("\n");
}

export function printLauncherHelp(): void {
  stdout.write(
    [
      "Aperture Launch",
      "Boot the opinionated local Aperture product.",
      "",
      "Usage:",
      "  aperture [options]",
      "",
      "What launch does:",
      "  - reuses an existing Aperture runtime when one is already live",
      "  - otherwise starts the runtime with learning enabled by default",
      "  - ensures Claude Code hooks are configured globally",
      "  - ensures an OpenCode profile exists",
      "  - starts Claude Code and OpenCode integrations when available",
      "  - opens the shared Aperture TUI",
      "",
      "Options:",
      "  --learning <on|off>         Start a new runtime with learning on or off",
      "  --no-claude                 Skip starting the Claude Code adapter",
      "  --no-opencode               Skip starting the OpenCode adapter",
      "  --capture                   Export a troubleshooting capture when Aperture exits",
      "  --capture-out <path>        Write the captured bundle to an explicit path",
      "  --help, -h                  Show this help text",
      "",
      "Examples:",
      "  aperture",
      "  aperture --capture",
      "  aperture --no-opencode",
      "",
      "Advanced:",
      "  aperture help internal",
    ].join("\n"),
  );
  stdout.write("\n");
}

export function printDoctorHelp(): void {
  stdout.write(
    [
      "Aperture Doctor",
      "Inspect runtime, integration, and state health without changing anything.",
      "",
      "Usage:",
      "  aperture doctor",
      "",
      "Doctor reports:",
      "  - Aperture product state paths under ~/.aperture",
      "  - Claude Code hook installation status",
      "  - the installed Claude hook command shape",
      "  - OpenCode profile and reachability status",
      "  - live Aperture runtimes on this machine",
    ].join("\n"),
  );
  stdout.write("\n");
}

export function printConfigHelp(): void {
  stdout.write(
    [
      "Aperture Config",
      "Inspect APERTURE.md preferences, policy rules, and learned suggestions.",
      "",
      "Usage:",
      "  aperture config",
      "  aperture config --root ~/.aperture/workspace/.aperture",
      "",
      "Config reports:",
      "  - active APERTURE.md and MEMORY.md paths",
      "  - parsed control mode and policy rules",
      "  - ignored or invalid markdown lines",
      "  - suggested APERTURE.md snippets based on learned behavior",
      "",
      "This command is read-only. Aperture never rewrites APERTURE.md for you.",
    ].join("\n"),
  );
  stdout.write("\n");
}

export function printDebugHelp(): void {
  stdout.write(
    [
      "Aperture Debug",
      "Print support-focused details for runtime, integrations, and local product state.",
      "",
      "Usage:",
      "  aperture debug",
      "  aperture debug runtime",
      "  aperture debug claude",
      "  aperture debug opencode",
      "  aperture debug state",
      "  aperture debug capture",
      "",
      "What it shows:",
      "  - product state paths and recent capture files",
      "  - Claude hook installation details",
      "  - OpenCode profile and reachability details",
      "  - live runtime discovery and primary runtime snapshot",
    ].join("\n"),
  );
  stdout.write("\n");
}

export function printCompletionHelp(): void {
  stdout.write(
    [
      "Aperture Completion",
      "Print a shell completion script for Aperture.",
      "",
      "Usage:",
      "  aperture completion bash",
      "  aperture completion zsh",
      "  aperture completion fish",
      "",
      "Examples:",
      "  aperture completion zsh > ~/.zsh/completions/_aperture",
      "  aperture completion bash > ~/.local/share/bash-completion/completions/aperture",
      "  aperture completion fish > ~/.config/fish/completions/aperture.fish",
    ].join("\n"),
  );
  stdout.write("\n");
}

export function printUninstallHelp(): void {
  stdout.write(
    [
      "Aperture Uninstall",
      "Remove Aperture-owned local state and Claude hook entries before uninstalling the package.",
      "",
      "Usage:",
      "  aperture uninstall --yes [--project /path/to/project]",
      "",
      "What it removes:",
      "  - ~/.aperture",
      "  - Aperture Claude hook entries from ~/.claude/settings.json",
      "  - Aperture Claude hook entries from any --project targets you pass",
      "  - .aperture under any --project targets you pass",
      "",
      "Examples:",
      "  aperture uninstall --yes",
      "  aperture uninstall --yes --project /path/to/repo",
      "",
      "After cleanup, remove the package itself with:",
      "  npm uninstall -g @tomismeta/aperture",
      "  pnpm remove -g @tomismeta/aperture",
    ].join("\n"),
  );
  stdout.write("\n");
}

export function printClaudeHelp(): void {
  stdout.write(
    [
      "Aperture Claude Code",
      "Configure Claude Code so Aperture can surface approvals and questions.",
      "",
      "Usage:",
      "  aperture claude connect --global",
      "  aperture claude connect /path/to/project",
      "  aperture claude disconnect --global",
      "  aperture claude disconnect /path/to/project",
      "",
      "Commands:",
      "  connect      Install Aperture Claude hook entries",
      "  disconnect   Remove Aperture Claude hook entries",
    ].join("\n"),
  );
  stdout.write("\n");
}

export function printOpencodeHelp(): void {
  stdout.write(
    [
      "Aperture OpenCode",
      "Connect Aperture to an OpenCode server-backed session.",
      "",
      "The opinionated Aperture flow expects:",
      "  1. opencode serve --port 4096",
      "  2. opencode attach http://127.0.0.1:4096",
      "  3. aperture",
    ].join("\n"),
  );
  stdout.write("\n");
}

export function printInternalHelp(): void {
  stdout.write(
    [
      "Aperture Internal",
      "Advanced runtime, TUI, adapter, and hook plumbing used for debugging and support.",
      "",
      "Usage:",
      "  aperture internal runtime [--learning on|off]",
      "  aperture internal tui",
      "  aperture internal claude-adapter",
      "  aperture internal opencode-adapter",
      "  aperture internal hook claude-forward",
    ].join("\n"),
  );
  stdout.write("\n");
}

function buildBashCompletionScript(): string {
  return `# aperture bash completion
_aperture_completion() {
  local cur prev command
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  command="\${COMP_WORDS[1]}"

  local root_commands="help doctor config debug completion uninstall claude opencode internal version"
  local help_topics="launch doctor config debug completion uninstall claude opencode internal"
  local claude_commands="connect disconnect"
  local debug_topics="runtime claude opencode state capture all"
  local completion_shells="bash zsh fish"
  local internal_commands="runtime tui claude-adapter opencode-adapter hook"
  local root_flags="--help -h --version -v --learning --no-claude --no-opencode --capture --capture-out"

  case "$command" in
    help)
      COMPREPLY=( $(compgen -W "$help_topics" -- "$cur") )
      return
      ;;
    claude)
      COMPREPLY=( $(compgen -W "$claude_commands" -- "$cur") )
      return
      ;;
    debug)
      COMPREPLY=( $(compgen -W "$debug_topics" -- "$cur") )
      return
      ;;
    completion)
      COMPREPLY=( $(compgen -W "$completion_shells" -- "$cur") )
      return
      ;;
    internal)
      COMPREPLY=( $(compgen -W "$internal_commands" -- "$cur") )
      return
      ;;
  esac

  if [[ "$cur" == -* ]]; then
    COMPREPLY=( $(compgen -W "$root_flags" -- "$cur") )
    return
  fi

  COMPREPLY=( $(compgen -W "$root_commands" -- "$cur") )
}

complete -F _aperture_completion aperture
`;
}

function buildZshCompletionScript(): string {
  return `#compdef aperture

local -a root_commands help_topics claude_commands debug_topics completion_shells internal_commands
root_commands=(
  'help:show help for Aperture or a topic'
  'doctor:print runtime, Claude, OpenCode, and state health'
  'config:inspect APERTURE.md and learned policy suggestions'
  'debug:print support details for troubleshooting'
  'completion:print a shell completion script'
  'uninstall:remove Aperture-owned state and Claude hooks'
  'claude:manage Claude Code setup'
  'opencode:show the OpenCode setup flow Aperture expects'
  'internal:advanced runtime, TUI, adapter, and hook plumbing'
  'version:print the installed Aperture version'
)
help_topics=(launch doctor config debug completion uninstall claude opencode internal)
claude_commands=(connect disconnect)
debug_topics=(runtime claude opencode state capture all)
completion_shells=(bash zsh fish)
internal_commands=(runtime tui claude-adapter opencode-adapter hook)

if (( CURRENT == 2 )); then
  _describe 'command' root_commands
  return
fi

case "$words[2]" in
  help)
    _describe 'help topic' help_topics
    ;;
  claude)
    _describe 'Claude command' claude_commands
    ;;
  debug)
    _describe 'debug topic' debug_topics
    ;;
  completion)
    _describe 'shell' completion_shells
    ;;
  internal)
    _describe 'internal command' internal_commands
    ;;
  *)
    _arguments \
      '--help[Show this help text]' \
      '-h[Show this help text]' \
      '--version[Print the installed Aperture version]' \
      '-v[Print the installed Aperture version]' \
      '--learning[Start a new runtime with learning on or off]:mode:(on off)' \
      '--no-claude[Skip starting the Claude Code adapter]' \
      '--no-opencode[Skip starting the OpenCode adapter]' \
      '--capture[Export a troubleshooting capture when Aperture exits]' \
      '--capture-out[Write the captured bundle to an explicit path]:path:_files'
    ;;
esac
`;
}

function buildFishCompletionScript(): string {
  return `complete -c aperture -f

complete -c aperture -n '__fish_use_subcommand' -a 'help' -d 'Show help for Aperture or a topic'
complete -c aperture -n '__fish_use_subcommand' -a 'doctor' -d 'Print runtime, Claude, OpenCode, and state health'
complete -c aperture -n '__fish_use_subcommand' -a 'config' -d 'Inspect APERTURE.md and learned policy suggestions'
complete -c aperture -n '__fish_use_subcommand' -a 'debug' -d 'Print support details for troubleshooting'
complete -c aperture -n '__fish_use_subcommand' -a 'completion' -d 'Print a shell completion script'
complete -c aperture -n '__fish_use_subcommand' -a 'uninstall' -d 'Remove Aperture-owned state and Claude hooks'
complete -c aperture -n '__fish_use_subcommand' -a 'claude' -d 'Manage Claude Code setup'
complete -c aperture -n '__fish_use_subcommand' -a 'opencode' -d 'Show the OpenCode setup flow Aperture expects'
complete -c aperture -n '__fish_use_subcommand' -a 'internal' -d 'Advanced runtime, TUI, adapter, and hook plumbing'
complete -c aperture -n '__fish_use_subcommand' -a 'version' -d 'Print the installed Aperture version'

complete -c aperture -n '__fish_seen_subcommand_from help' -a 'launch doctor config debug completion uninstall claude opencode internal'
complete -c aperture -n '__fish_seen_subcommand_from claude' -a 'connect disconnect'
complete -c aperture -n '__fish_seen_subcommand_from debug' -a 'runtime claude opencode state capture all'
complete -c aperture -n '__fish_seen_subcommand_from completion' -a 'bash zsh fish'
complete -c aperture -n '__fish_seen_subcommand_from internal' -a 'runtime tui claude-adapter opencode-adapter hook'

complete -c aperture -l help -s h -d 'Show this help text'
complete -c aperture -l version -s v -d 'Print the installed Aperture version'
complete -c aperture -l learning -d 'Start a new runtime with learning on or off'
complete -c aperture -l no-claude -d 'Skip starting the Claude Code adapter'
complete -c aperture -l no-opencode -d 'Skip starting the OpenCode adapter'
complete -c aperture -l capture -d 'Export a troubleshooting capture when Aperture exits'
complete -c aperture -l capture-out -r -d 'Write the captured bundle to an explicit path'
`;
}
