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
        .window(iced::window::Settings {
            size: iced::Size::new(1280.0, 800.0),
            maximized: true,
            ..Default::default()
        })
        .run()
}
