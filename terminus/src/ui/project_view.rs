use iced::widget::{column, container, row, text, Space};
use iced::{Alignment, Element, Length};

use crate::app::ProjectState;
use crate::message::Message;
use crate::ui::{sidebar, tabs, terminal_tab, theme};

pub fn body<'a>(state: &'a ProjectState) -> Element<'a, Message> {
    let tab_bar = tabs::view(state);

    let terminal_area: Element<'_, Message> = if let Some(active) = state.active_tab {
        if let Some(tab) = state.tabs.get(&active) {
            terminal_tab::view(tab)
        } else {
            empty_terminal_placeholder()
        }
    } else {
        empty_terminal_placeholder()
    };

    let main_col = column![tab_bar, terminal_area]
        .width(Length::Fill)
        .height(Length::Fill);

    if state.is_git_repo {
        row![sidebar::view(state), main_col]
            .width(Length::Fill)
            .height(Length::Fill)
            .into()
    } else {
        main_col.into()
    }
}

pub fn status_bar<'a>(state: &'a ProjectState) -> Element<'a, Message> {
    let cwd = state
        .selected_wt
        .clone()
        .unwrap_or_else(|| state.project.path.clone());
    let n = state.tabs.len();
    let label = if n == 1 { "tab" } else { "tabs" };

    container(
        row![
            text("cwd").size(theme::FONT_SIZE).color(theme::TEXT_DIM),
            text(theme::truncate_middle(&cwd.to_string_lossy(), 80)).size(theme::FONT_SIZE),
            Space::new().width(Length::Fill),
            text(format!("· {} {}", n, label))
                .size(theme::FONT_SIZE)
                .color(theme::TEXT_DIM),
        ]
        .spacing(theme::PAD_SM)
        .align_y(Alignment::Center)
        .padding([theme::PAD_XS, theme::PAD_MD]),
    )
    .width(Length::Fill)
    .style(theme::status_bar)
    .into()
}

fn empty_terminal_placeholder<'a>() -> Element<'a, Message> {
    let card = container(
        column![
            text("No terminal open").size(theme::FONT_SIZE),
            text("Use the buttons above to start one.")
                .size(theme::FONT_SIZE)
                .color(theme::TEXT_DIM),
        ]
        .spacing(theme::PAD_SM)
        .align_x(Alignment::Center),
    )
    .padding(theme::PAD_LG)
    .max_width(360.0)
    .style(theme::card);

    container(card)
        .center_x(Length::Fill)
        .center_y(Length::Fill)
        .width(Length::Fill)
        .height(Length::Fill)
        .style(theme::panel)
        .into()
}
