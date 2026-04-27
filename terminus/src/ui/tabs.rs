use iced::widget::{button, container, mouse_area, row, scrollable, text, Space};
use iced::{Alignment, Element, Length};

use crate::app::{ProjectState, TabKind};
use crate::message::Message;
use crate::ui::theme;

pub fn view<'a>(state: &'a ProjectState) -> Element<'a, Message> {
    let mut tabs_row = row![].spacing(theme::PAD_XS).align_y(Alignment::Center);

    for id in &state.tab_order {
        if let Some(tab) = state.tabs.get(id) {
            let active = state.active_tab == Some(*id);
            let hovered = state.hovered_tab == Some(*id);
            let label_text = text(truncate(&tab.title, 22)).size(theme::FONT_SIZE);
            let label_btn = button(label_text)
                .padding([theme::PAD_SM, theme::PAD_MD])
                .style(theme::flat_button)
                .on_press(Message::ActivateTab(*id));
            let close_btn = button(text("×").size(theme::FONT_SIZE).color(theme::TEXT_DIM))
                .padding([theme::PAD_XS + 2.0, theme::PAD_SM])
                .style(theme::flat_button)
                .on_press(Message::CloseTab(*id));
            let chip_style = match (tab.kind, active, hovered) {
                (TabKind::Claude, true, _) => theme::tab_active_claude,
                (TabKind::Claude, false, true) => theme::tab_hover_claude,
                (TabKind::Claude, false, false) => theme::tab_inactive_claude,
                (TabKind::Shell, true, _) => theme::tab_active_shell,
                (TabKind::Shell, false, true) => theme::tab_hover_shell,
                (TabKind::Shell, false, false) => theme::tab_inactive_shell,
            };
            let chip = container(
                row![label_btn, close_btn]
                    .spacing(0)
                    .align_y(Alignment::Center),
            )
            .style(chip_style);
            let cell = mouse_area(chip)
                .on_enter(Message::TabHoverEnter(*id))
                .on_exit(Message::TabHoverExit(*id));
            tabs_row = tabs_row.push(cell);
        }
    }

    let tabs_scroll = scrollable(tabs_row)
        .direction(scrollable::Direction::Horizontal(
            scrollable::Scrollbar::default()
                .width(4)
                .scroller_width(4),
        ))
        .width(Length::Fill);

    let actions = row![
        button(text("+s").size(theme::FONT_SIZE))
            .padding([theme::PAD_XS, theme::PAD_SM + 2.0])
            .style(theme::secondary_button)
            .on_press(Message::NewShellTab),
        button(text("+c").size(theme::FONT_SIZE))
            .padding([theme::PAD_XS, theme::PAD_SM + 2.0])
            .style(theme::primary_button)
            .on_press(Message::NewClaudeTab),
    ]
    .spacing(theme::PAD_XS)
    .align_y(Alignment::Center);

    let bar = row![
        tabs_scroll,
        Space::new().width(Length::Fixed(theme::PAD_SM)),
        actions,
    ]
    .spacing(0)
    .align_y(Alignment::Center)
    .width(Length::Fill);

    container(bar)
        .padding([theme::PAD_XS, theme::PAD_SM])
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
