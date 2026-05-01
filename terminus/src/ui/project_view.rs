use iced::widget::{button, column, container, row, text, Space};
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

    row![sidebar::view(state), main_col]
        .width(Length::Fill)
        .height(Length::Fill)
        .into()
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
            container(text("cwd").size(theme::FONT_SM))
                .padding([1.0, theme::PAD_XS + 2.0])
                .style(theme::badge_accent),
            text(theme::truncate_middle(&cwd.to_string_lossy(), 80)).size(theme::FONT_SIZE),
            Space::new().width(Length::Fill),
            container(text(format!("{} {}", n, label)).size(theme::FONT_SM))
                .padding([1.0, theme::PAD_XS + 2.0])
                .style(theme::badge),
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
            text("No terminal open").size(20.0),
            text("Start a shell or Claude session for the selected folder.")
                .size(theme::FONT_SIZE)
                .color(theme::TEXT_DIM),
            row![
                button(text("+ shell").size(theme::FONT_SIZE))
                    .padding([theme::PAD_SM, theme::PAD_MD])
                    .style(theme::secondary_button)
                    .on_press(Message::NewShellTab),
                button(text("+ claude").size(theme::FONT_SIZE))
                    .padding([theme::PAD_SM, theme::PAD_MD])
                    .style(theme::primary_button)
                    .on_press(Message::NewClaudeTab),
            ]
            .spacing(theme::PAD_SM)
            .align_y(Alignment::Center),
        ]
        .spacing(theme::PAD_MD)
        .align_x(Alignment::Center),
    )
    .padding(theme::PAD_XL)
    .max_width(460.0)
    .style(theme::empty_card);

    container(card)
        .center_x(Length::Fill)
        .center_y(Length::Fill)
        .width(Length::Fill)
        .height(Length::Fill)
        .style(theme::panel)
        .into()
}
