use iced::widget::{button, container, row, scrollable, text, Space};
use iced::{Alignment, Element, Length};

use crate::app::ProjectState;
use crate::message::Message;
use crate::ui::theme;

pub fn view<'a>(state: &'a ProjectState) -> Element<'a, Message> {
    let mut tabs_row = row![].spacing(theme::PAD_XS).align_y(Alignment::Center);

    for id in &state.tab_order {
        if let Some(tab) = state.tabs.get(id) {
            let active = state.active_tab == Some(*id);
            let label_text = text(truncate(&tab.title, 22)).size(12);
            let label_btn = button(label_text)
                .padding([theme::PAD_XS + 2.0, theme::PAD_SM + 2.0])
                .style(theme::ghost_button)
                .on_press(Message::ActivateTab(*id));
            let close_btn = button(text("×").size(12))
                .padding([theme::PAD_XS, theme::PAD_SM])
                .style(theme::ghost_button)
                .on_press(Message::CloseTab(*id));
            let cell = container(
                row![label_btn, close_btn]
                    .spacing(4)
                    .align_y(Alignment::Center),
            )
            .padding(2)
            .style(if active { theme::tab_active } else { theme::tab_inactive });
            tabs_row = tabs_row.push(cell);
        }
    }

    let tabs_scroll = scrollable(tabs_row)
        .direction(scrollable::Direction::Horizontal(
            scrollable::Scrollbar::default()
                .width(6)
                .scroller_width(6),
        ))
        .width(Length::Fill);

    let actions = row![
        button(text("+ Terminal").size(12))
            .padding([theme::PAD_XS + 2.0, theme::PAD_MD])
            .style(theme::secondary_button)
            .on_press(Message::NewShellTab),
        button(text("Open Claude Code").size(12))
            .padding([theme::PAD_XS + 2.0, theme::PAD_MD])
            .style(theme::primary_button)
            .on_press(Message::NewClaudeTab),
    ]
    .spacing(theme::PAD_SM)
    .align_y(Alignment::Center);

    let bar = row![
        tabs_scroll,
        Space::new().width(Length::Fixed(12.0)),
        actions,
    ]
    .spacing(0)
    .align_y(Alignment::Center)
    .width(Length::Fill);

    container(bar)
        .padding([theme::PAD_SM, theme::PAD_MD])
        .width(Length::Fill)
        .style(theme::tab_bar_bg)
        .into()
}

fn truncate(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        let head: String = s.chars().take(n.saturating_sub(1)).collect();
        format!("{}…", head)
    }
}
