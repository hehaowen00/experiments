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
pub fn claude_args(shell: &str, session_id: &str, resume: bool) -> Vec<String> {
    let claude_cmd = if resume {
        format!("claude --resume {}", session_id)
    } else {
        format!("claude --session-id {}", session_id)
    };
    vec![
        "-i".to_string(),
        "-c".to_string(),
        format!("{}; exec {} -i", claude_cmd, shell),
    ]
}
