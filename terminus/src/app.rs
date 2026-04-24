use std::collections::HashMap;
use std::path::PathBuf;

use iced::{Element, Subscription, Task};

use crate::db::{self, Db};
use crate::domain::project::Project;
use crate::domain::worktree::Worktree;
use crate::git::{repo, worktree_cmd};
use crate::message::{Message, TabId};
use crate::pty::shell;
use crate::ui::{landing, modals, project_tabs, project_view};

pub struct App {
    pub db: Db,
    pub projects: Vec<Project>,
    pub open_tabs: Vec<ProjectState>,
    pub active_project: Option<String>,
    pub next_tab_id: TabId,
    pub error: Option<String>,
    /// Most recent terminal-pane bounds observed from a resize event.
    /// Replayed into newly-activated or newly-spawned terminals so they
    /// fill the pane from the first frame instead of waiting for an event.
    pub last_pane_size: Option<iced::Size>,
}

pub struct ProjectState {
    pub project: Project,
    pub is_git_repo: bool,
    pub worktrees: Vec<Worktree>,
    pub selected_wt: Option<PathBuf>,
    pub tabs: HashMap<TabId, Tab>,
    pub tab_order: Vec<TabId>,
    pub active_tab: Option<TabId>,
    pub modal: Option<Modal>,
}

pub struct Tab {
    pub id: TabId,
    pub title: String,
    pub cwd: PathBuf,
    pub term: iced_term::Terminal,
}

pub struct Modal {
    pub kind: ModalKind,
    pub branch: String,
    pub path: String,
    pub new_branch: bool,
    pub force: bool,
}

pub enum ModalKind {
    AddWorktree,
}

impl App {
    pub fn new() -> (Self, Task<Message>) {
        let db = match db::open() {
            Ok(d) => d,
            Err(e) => {
                tracing::error!("db open failed: {e:#}");
                let conn = rusqlite::Connection::open_in_memory().expect("in-memory sqlite");
                std::rc::Rc::new(std::cell::RefCell::new(conn))
            }
        };
        let projects = db::list_projects(&db).unwrap_or_default();
        (
            Self {
                db,
                projects,
                open_tabs: Vec::new(),
                active_project: None,
                next_tab_id: 1,
                error: None,
                last_pane_size: None,
            },
            Task::none(),
        )
    }

    pub fn title(&self) -> String {
        match self.active_state() {
            Some(state) => format!("terminus — {}", state.project.name),
            None => "terminus".into(),
        }
    }

    pub fn subscription(&self) -> Subscription<Message> {
        let mut subs: Vec<Subscription<Message>> = self
            .open_tabs
            .iter()
            .flat_map(|p| {
                p.tabs.values().map(|tab| {
                    tab.term
                        .subscription()
                        .with(tab.id)
                        .map(|(id, e)| Message::Terminal(id, e))
                })
            })
            .collect();

        subs.push(iced::event::listen_with(|event, _status, _id| match event {
            iced::Event::Window(iced::window::Event::Opened { size, .. }) => {
                Some(Message::WindowSized(size))
            }
            iced::Event::Window(iced::window::Event::Resized(size)) => {
                Some(Message::WindowSized(size))
            }
            iced::Event::Keyboard(iced::keyboard::Event::KeyPressed {
                ref key,
                ref modified_key,
                modifiers,
                ref text,
                ..
            }) => {
                if !modifiers.command() {
                    return None;
                }
                let shift = modifiers.shift();
                tracing::info!(
                    "terminus key: key={:?} modified_key={:?} modifiers={:?} text={:?}",
                    key,
                    modified_key,
                    modifiers,
                    text
                );
                let candidate = |c: &str| -> Option<&'static str> {
                    match c {
                        "[" | "{" => Some("["),
                        "]" | "}" => Some("]"),
                        _ => None,
                    }
                };
                let which = match key {
                    iced::keyboard::Key::Character(c) => candidate(c.as_str()),
                    _ => None,
                }
                .or_else(|| match modified_key {
                    iced::keyboard::Key::Character(c) => candidate(c.as_str()),
                    _ => None,
                })
                .or_else(|| text.as_deref().and_then(candidate));

                match (which, shift) {
                    (Some("["), false) => Some(Message::PrevTerminalTab),
                    (Some("]"), false) => Some(Message::NextTerminalTab),
                    (Some("["), true) => Some(Message::PrevProjectTab),
                    (Some("]"), true) => Some(Message::NextProjectTab),
                    _ => None,
                }
            }
            _ => None,
        }));

        Subscription::batch(subs)
    }

    fn compute_pane_size(&self, window: iced::Size) -> iced::Size {
        // Chrome estimates: project-tab bar ~44, sub-tab bar ~44,
        // status bar ~28. Sidebar 240 for git repos.
        let sidebar = if self
            .active_state()
            .map_or(false, |s| s.is_git_repo)
        {
            240.0
        } else {
            0.0
        };
        let chrome_h = 44.0 + 44.0 + 28.0;
        iced::Size::new(
            (window.width - sidebar).max(200.0),
            (window.height - chrome_h).max(200.0),
        )
    }

    pub fn active_state(&self) -> Option<&ProjectState> {
        let id = self.active_project.as_ref()?;
        self.open_tabs.iter().find(|p| &p.project.id == id)
    }

    pub fn active_state_mut(&mut self) -> Option<&mut ProjectState> {
        let id = self.active_project.as_ref()?.clone();
        self.open_tabs.iter_mut().find(|p| p.project.id == id)
    }

    fn find_tab_for_terminal(&mut self, terminal_id: TabId) -> Option<&mut ProjectState> {
        self.open_tabs
            .iter_mut()
            .find(|p| p.tabs.contains_key(&terminal_id))
    }

    pub fn update(&mut self, msg: Message) -> Task<Message> {
        match msg {
            Message::RefreshProjects => {
                self.projects = db::list_projects(&self.db).unwrap_or_default();
            }
            Message::AddProjectClicked => {
                return Task::perform(pick_folder(), Message::AddProjectPicked);
            }
            Message::AddProjectPicked(Some(path)) => {
                self.add_project(path);
            }
            Message::AddProjectPicked(None) => {}
            Message::OpenProject(id) => {
                self.open_project_tab(&id);
            }
            Message::CloseProjectTab(id) => {
                self.close_project_tab(&id);
            }
            Message::FocusProjectTab(id) => {
                if let Some(ref pid) = id {
                    if self.open_tabs.iter().any(|p| &p.project.id == pid) {
                        self.active_project = Some(pid.clone());
                    }
                } else {
                    self.active_project = None;
                }
            }
            Message::RemoveProject(id) => {
                if let Err(e) = db::delete_project(&self.db, &id) {
                    self.error = Some(format!("delete project: {e:#}"));
                }
                self.projects = db::list_projects(&self.db).unwrap_or_default();
            }
            Message::BackToLanding => {
                self.active_project = None;
            }
            Message::ProjectsLoaded(list) => {
                self.projects = list;
            }
            Message::SelectWorktree(p) => {
                if let Some(state) = self.active_state_mut() {
                    state.selected_wt = Some(p);
                }
            }
            Message::RefreshWorktrees => {
                if let Some(state) = self.active_state_mut() {
                    state.worktrees = worktree_cmd::list(&state.project.path).unwrap_or_default();
                }
            }
            Message::OpenAddWorktreeModal => {
                if let Some(state) = self.active_state_mut() {
                    let suggested_branch = format!(
                        "feature/{}",
                        ksuid::Ksuid::generate().to_base62()[..6].to_ascii_lowercase()
                    );
                    let suggested_path =
                        worktree_cmd::suggest_path(&state.project.path, &suggested_branch);
                    state.modal = Some(Modal {
                        kind: ModalKind::AddWorktree,
                        branch: suggested_branch,
                        path: suggested_path.to_string_lossy().into_owned(),
                        new_branch: true,
                        force: false,
                    });
                }
            }
            Message::CloseModal => {
                if let Some(state) = self.active_state_mut() {
                    state.modal = None;
                }
            }
            Message::AddWtBranchChanged(v) => {
                if let Some(state) = self.active_state_mut() {
                    let repo_path = state.project.path.clone();
                    if let Some(m) = &mut state.modal {
                        m.branch = v;
                        if m.new_branch {
                            m.path = worktree_cmd::suggest_path(&repo_path, &m.branch)
                                .to_string_lossy()
                                .into_owned();
                        }
                    }
                }
            }
            Message::AddWtPathChanged(v) => {
                if let Some(state) = self.active_state_mut() {
                    if let Some(m) = &mut state.modal {
                        m.path = v;
                    }
                }
            }
            Message::AddWtNewBranchToggled(v) => {
                if let Some(state) = self.active_state_mut() {
                    if let Some(m) = &mut state.modal {
                        m.new_branch = v;
                    }
                }
            }
            Message::AddWtForceToggled(v) => {
                if let Some(state) = self.active_state_mut() {
                    if let Some(m) = &mut state.modal {
                        m.force = v;
                    }
                }
            }
            Message::AddWtBrowsePath => {
                return Task::perform(pick_folder(), Message::AddWtPathPicked);
            }
            Message::AddWtPathPicked(Some(p)) => {
                if let Some(state) = self.active_state_mut() {
                    if let Some(m) = &mut state.modal {
                        m.path = p.to_string_lossy().into_owned();
                    }
                }
            }
            Message::AddWtPathPicked(None) => {}
            Message::AddWtSubmit => {
                if let Some(state) = self.active_state_mut() {
                    if let Some(m) = state.modal.take() {
                        let repo_path = state.project.path.clone();
                        let path = PathBuf::from(&m.path);
                        let opts = worktree_cmd::AddOptions {
                            path: &path,
                            branch: if m.new_branch { None } else { Some(m.branch.as_str()) },
                            new_branch: if m.new_branch { Some(m.branch.as_str()) } else { None },
                            start_point: None,
                            detach: false,
                            force: m.force,
                        };
                        match worktree_cmd::add(&repo_path, opts) {
                            Ok(()) => {
                                state.worktrees =
                                    worktree_cmd::list(&repo_path).unwrap_or_default();
                                state.selected_wt = Some(path);
                            }
                            Err(e) => self.error = Some(format!("add worktree: {e:#}")),
                        }
                    }
                }
            }
            Message::RemoveWorktreeClicked(p) => {
                let mut err: Option<String> = None;
                if let Some(state) = self.active_state_mut() {
                    let repo_path = state.project.path.clone();
                    if let Err(e) = worktree_cmd::remove(&repo_path, &p, true) {
                        err = Some(format!("remove worktree: {e:#}"));
                    }
                    state.worktrees = worktree_cmd::list(&repo_path).unwrap_or_default();
                    if state.selected_wt.as_ref() == Some(&p) {
                        state.selected_wt = state.worktrees.first().map(|w| w.path.clone());
                    }
                }
                if err.is_some() {
                    self.error = err;
                }
            }
            Message::PruneWorktreesClicked => {
                let mut err: Option<String> = None;
                if let Some(state) = self.active_state_mut() {
                    let repo_path = state.project.path.clone();
                    if let Err(e) = worktree_cmd::prune(&repo_path) {
                        err = Some(format!("prune: {e:#}"));
                    }
                    state.worktrees = worktree_cmd::list(&repo_path).unwrap_or_default();
                }
                if err.is_some() {
                    self.error = err;
                }
            }
            Message::WtOpFinished(Err(e)) => self.error = Some(e),
            Message::WtOpFinished(Ok(())) => {}
            Message::NewShellTab => {
                let next_id = self.next_tab_id;
                let initial_size = self.last_pane_size;
                if let Some(state) = self.active_state_mut() {
                    if let Some(cwd) = state
                        .selected_wt
                        .clone()
                        .or_else(|| Some(state.project.path.clone()))
                    {
                        let shell_bin = shell::detect_shell();
                        if spawn_tab(
                            state,
                            next_id,
                            cwd,
                            shell_bin,
                            shell::plain_args(),
                            false,
                            initial_size,
                        ) {
                            self.next_tab_id += 1;
                        }
                    }
                }
            }
            Message::NewClaudeTab => {
                let next_id = self.next_tab_id;
                let initial_size = self.last_pane_size;
                if let Some(state) = self.active_state_mut() {
                    if let Some(cwd) = state
                        .selected_wt
                        .clone()
                        .or_else(|| Some(state.project.path.clone()))
                    {
                        let shell_bin = shell::detect_shell();
                        let args = shell::claude_args(&shell_bin);
                        if spawn_tab(state, next_id, cwd, shell_bin, args, true, initial_size) {
                            self.next_tab_id += 1;
                        }
                    }
                }
            }
            Message::CloseTab(id) => {
                if let Some(state) = self.find_tab_for_terminal(id) {
                    state.tabs.remove(&id);
                    state.tab_order.retain(|t| *t != id);
                    if state.active_tab == Some(id) {
                        state.active_tab = state.tab_order.last().copied();
                    }
                }
            }
            Message::ActivateTab(id) => {
                let size = self.last_pane_size;
                if let Some(state) = self.find_tab_for_terminal(id) {
                    if let Some(tab) = state.tabs.get_mut(&id) {
                        state.active_tab = Some(id);
                        if let Some(size) = size {
                            let _ = tab.term.handle(iced_term::Command::ProxyToBackend(
                                iced_term::BackendCommand::Resize(Some(size), None),
                            ));
                        }
                    }
                }
            }
            Message::Terminal(id, event) => {
                let iced_term::Event::BackendCall(_, cmd) = event.clone();
                if let iced_term::BackendCommand::Resize(Some(size), _) = cmd {
                    self.last_pane_size = Some(size);
                }
                if let Some(state) = self.find_tab_for_terminal(id) {
                    if let Some(tab) = state.tabs.get_mut(&id) {
                        let iced_term::Event::BackendCall(_, cmd) = event;
                        let action = tab.term.handle(iced_term::Command::ProxyToBackend(cmd));
                        match action {
                            iced_term::actions::Action::Shutdown => {
                                state.tabs.remove(&id);
                                state.tab_order.retain(|t| *t != id);
                                if state.active_tab == Some(id) {
                                    state.active_tab = state.tab_order.last().copied();
                                }
                            }
                            iced_term::actions::Action::ChangeTitle(title) => {
                                if let Some(tab) = state.tabs.get_mut(&id) {
                                    tab.title = title;
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }
            Message::WorktreesLoaded(list) => {
                if let Some(state) = self.active_state_mut() {
                    state.worktrees = list;
                }
            }
            Message::PrevTerminalTab => {
                self.step_terminal_tab(-1);
            }
            Message::NextTerminalTab => {
                self.step_terminal_tab(1);
            }
            Message::PrevProjectTab => {
                self.step_project_tab(-1);
            }
            Message::NextProjectTab => {
                self.step_project_tab(1);
            }
            Message::WindowSized(size) => {
                let pane = self.compute_pane_size(size);
                self.last_pane_size = Some(pane);
                for project in self.open_tabs.iter_mut() {
                    for tab in project.tabs.values_mut() {
                        let _ = tab.term.handle(iced_term::Command::ProxyToBackend(
                            iced_term::BackendCommand::Resize(Some(pane), None),
                        ));
                    }
                }
            }
            Message::Error(e) => self.error = Some(e),
            Message::DismissError => self.error = None,
        }
        Task::none()
    }

    pub fn view(&self) -> Element<'_, Message> {
        use iced::widget::{column, container};
        use iced::Length;
        use crate::ui::theme;

        let tab_strip = project_tabs::view(self);

        let err = landing::error_banner(&self.error);

        let body: Element<'_, Message> = match self.active_state() {
            Some(state) => project_view::body(state),
            None => landing::view(self),
        };

        let status: Element<'_, Message> = match self.active_state() {
            Some(state) => project_view::status_bar(state),
            None => iced::widget::Space::new()
                .height(Length::Fixed(0.0))
                .into(),
        };

        let root = container(
            column![tab_strip, err, body, status]
                .spacing(0)
                .width(Length::Fill)
                .height(Length::Fill),
        )
        .width(Length::Fill)
        .height(Length::Fill)
        .style(theme::panel);

        if let Some(state) = self.active_state() {
            if let Some(modal) = &state.modal {
                return modals::overlay(root.into(), modals::add_worktree(modal));
            }
        }
        root.into()
    }

    fn open_project_tab(&mut self, id: &str) {
        if self.open_tabs.iter().any(|p| p.project.id == id) {
            self.active_project = Some(id.to_string());
            return;
        }
        let Some(project) = self.projects.iter().find(|p| p.id == id).cloned() else {
            return;
        };
        let _ = db::touch_last_used(&self.db, &project.id);
        let is_git_repo = repo::is_git_repo(&project.path);
        let worktrees = if is_git_repo {
            worktree_cmd::list(&project.path).unwrap_or_default()
        } else {
            Vec::new()
        };
        let pid = project.id.clone();
        self.open_tabs.push(ProjectState {
            project,
            is_git_repo,
            worktrees,
            selected_wt: None,
            tabs: HashMap::new(),
            tab_order: Vec::new(),
            active_tab: None,
            modal: None,
        });
        self.active_project = Some(pid);
        self.projects = db::list_projects(&self.db).unwrap_or_default();
    }

    fn close_project_tab(&mut self, id: &str) {
        let Some(idx) = self.open_tabs.iter().position(|p| p.project.id == id) else {
            return;
        };
        self.open_tabs.remove(idx);
        if self.active_project.as_deref() == Some(id) {
            self.active_project = if idx == 0 {
                self.open_tabs.first().map(|p| p.project.id.clone())
            } else {
                self.open_tabs
                    .get(idx - 1)
                    .map(|p| p.project.id.clone())
                    .or_else(|| self.open_tabs.first().map(|p| p.project.id.clone()))
            };
        }
    }

    fn step_terminal_tab(&mut self, delta: i32) {
        let size = self.last_pane_size;
        let Some(state) = self.active_state_mut() else {
            return;
        };
        if state.tab_order.is_empty() {
            return;
        }
        let current = state
            .active_tab
            .and_then(|id| state.tab_order.iter().position(|t| *t == id))
            .unwrap_or(0);
        let len = state.tab_order.len() as i32;
        let next_idx = ((current as i32 + delta).rem_euclid(len)) as usize;
        let next_id = state.tab_order[next_idx];
        state.active_tab = Some(next_id);
        if let Some(size) = size {
            if let Some(tab) = state.tabs.get_mut(&next_id) {
                let _ = tab.term.handle(iced_term::Command::ProxyToBackend(
                    iced_term::BackendCommand::Resize(Some(size), None),
                ));
            }
        }
    }

    fn step_project_tab(&mut self, delta: i32) {
        if self.open_tabs.is_empty() {
            return;
        }
        let current = self
            .active_project
            .as_ref()
            .and_then(|id| self.open_tabs.iter().position(|p| &p.project.id == id))
            .map(|i| i as i32)
            .unwrap_or(if delta > 0 { -1 } else { self.open_tabs.len() as i32 });
        let len = self.open_tabs.len() as i32;
        let next_idx = ((current + delta).rem_euclid(len)) as usize;
        self.active_project = Some(self.open_tabs[next_idx].project.id.clone());
    }

    fn add_project(&mut self, path: PathBuf) {
        let canonical = std::fs::canonicalize(&path).unwrap_or(path);
        let as_str = canonical.to_string_lossy().to_string();
        match db::find_project_by_path(&self.db, &as_str) {
            Ok(Some(_)) => {
                self.error = Some(format!("project already added: {}", as_str));
            }
            Ok(None) => {
                let project = Project::new(canonical.clone());
                if let Err(e) = db::insert_project(&self.db, &project) {
                    self.error = Some(format!("insert project: {e:#}"));
                } else {
                    self.projects = db::list_projects(&self.db).unwrap_or_default();
                }
            }
            Err(e) => {
                self.error = Some(format!("db lookup: {e:#}"));
            }
        }
    }
}

/// Returns true if the terminal was created and inserted.
fn spawn_tab(
    state: &mut ProjectState,
    id: TabId,
    cwd: PathBuf,
    program: String,
    args: Vec<String>,
    claude: bool,
    initial_size: Option<iced::Size>,
) -> bool {
    let settings = iced_term::settings::Settings {
        font: iced_term::settings::FontSettings {
            size: 13.0,
            font_type: iced::Font::MONOSPACE,
            ..Default::default()
        },
        theme: iced_term::settings::ThemeSettings::default(),
        backend: iced_term::settings::BackendSettings {
            program,
            args,
            working_directory: Some(cwd.clone()),
            env: Default::default(),
        },
    };

    match iced_term::Terminal::new(id, settings) {
        Ok(mut term) => {
            let size = initial_size.unwrap_or_else(|| iced::Size::new(1000.0, 700.0));
            let _ = term.handle(iced_term::Command::ProxyToBackend(
                iced_term::BackendCommand::Resize(Some(size), None),
            ));

            let title = if claude {
                format!("claude {}", cwd.file_name().and_then(|s| s.to_str()).unwrap_or(""))
            } else {
                format!("zsh {}", cwd.file_name().and_then(|s| s.to_str()).unwrap_or(""))
            };
            state.tabs.insert(
                id,
                Tab {
                    id,
                    title,
                    cwd,
                    term,
                },
            );
            state.tab_order.push(id);
            state.active_tab = Some(id);
            true
        }
        Err(e) => {
            tracing::error!("failed to create terminal: {e:?}");
            false
        }
    }
}

async fn pick_folder() -> Option<PathBuf> {
    rfd::AsyncFileDialog::new()
        .set_title("Select a folder")
        .pick_folder()
        .await
        .map(|h| h.path().to_path_buf())
}

