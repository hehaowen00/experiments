pub fn detect_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
}

/// Args for an interactive shell (sources ~/.zshrc etc., skips login profile).
pub fn plain_args() -> Vec<String> {
    vec!["-i".to_string()]
}

/// Args for a shell that runs `claude`, then drops into an interactive shell
/// in the same cwd on exit. `-i` ensures rc files are sourced so claude inherits
/// the user's PATH, aliases, and env.
pub fn claude_args(shell: &str) -> Vec<String> {
    vec![
        "-i".to_string(),
        "-c".to_string(),
        format!("claude; exec {} -i", shell),
    ]
}
