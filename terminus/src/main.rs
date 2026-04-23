mod app;
mod config;
mod db;
mod domain;
mod git;
mod message;
mod pty;
mod ui;

use tracing_subscriber::EnvFilter;

fn main() -> iced::Result {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("terminus=info")),
        )
        .init();

    iced::application(app::App::new, app::App::update, app::App::view)
        .title(app::App::title)
        .subscription(app::App::subscription)
        .window_size(iced::Size { width: 1280.0, height: 800.0 })
        .run()
}
