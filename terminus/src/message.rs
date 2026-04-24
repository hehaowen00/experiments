use std::path::PathBuf;

use crate::domain::project::Project;
use crate::domain::worktree::Worktree;

pub type TabId = u64;

#[derive(Debug, Clone)]
pub enum Message {
    // Landing
    RefreshProjects,
    ProjectsLoaded(Vec<Project>),
    AddProjectClicked,
    AddProjectPicked(Option<PathBuf>),
    OpenProject(String),
    RemoveProject(String),

    // Project tabs
    CloseProjectTab(String),
    FocusProjectTab(Option<String>),

    // Project view
    BackToLanding,
    WorktreesLoaded(Vec<Worktree>),
    SelectWorktree(PathBuf),
    RefreshWorktrees,

    // Worktree modal
    OpenAddWorktreeModal,
    CloseModal,
    AddWtBranchChanged(String),
    AddWtPathChanged(String),
    AddWtNewBranchToggled(bool),
    AddWtForceToggled(bool),
    AddWtBrowsePath,
    AddWtPathPicked(Option<PathBuf>),
    AddWtSubmit,
    RemoveWorktreeClicked(PathBuf),
    PruneWorktreesClicked,
    WtOpFinished(Result<(), String>),

    // Tabs
    NewShellTab,
    NewClaudeTab,
    CloseTab(TabId),
    ActivateTab(TabId),

    // Terminal widget event (id, event)
    Terminal(TabId, iced_term::Event),

    // Keyboard shortcuts
    PrevTerminalTab,
    NextTerminalTab,
    PrevProjectTab,
    NextProjectTab,

    // Window
    WindowSized(iced::Size),

    // Errors
    Error(String),
    DismissError,
}
