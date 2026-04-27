use iced::widget::{button, container, mouse_area, row, scrollable, text, Space};
use iced::{Alignment, Element, Length};

use crate::app::App;
use crate::message::Message;
use crate::ui::theme;

pub fn view<'a>(app: &'a App) -> Element<'a, Message> {
    let home_active = app.active_project.is_none();
    let home_chip = container(
        button(text("home").size(theme::FONT_SIZE))
            .padding([theme::PAD_SM, theme::PAD_MD])
            .style(theme::flat_button)
            .on_press(Message::FocusProjectTab(None)),
    )
    .style(if home_active {
        theme::tab_active
    } else {
        theme::tab_inactive
    });

    let mut strip = row![home_chip]
        .spacing(theme::PAD_XS)
        .align_y(Alignment::Center);

    for state in &app.open_tabs {
        let pid = state.project.id.clone();
        let active = app.active_project.as_deref() == Some(state.project.id.as_str());
        let hovered = app.hovered_project.as_deref() == Some(state.project.id.as_str());
        let label_btn = button(text(truncate(&state.project.name, 22)).size(theme::FONT_SIZE))
            .padding([theme::PAD_SM, theme::PAD_MD])
            .style(theme::flat_button)
            .on_press(Message::FocusProjectTab(Some(pid.clone())));
        let close_btn = button(text("×").size(theme::FONT_SIZE).color(theme::TEXT_DIM))
            .padding([theme::PAD_XS + 2.0, theme::PAD_SM])
            .style(theme::flat_button)
            .on_press(Message::CloseProjectTab(pid.clone()));
        let chip = container(
            row![label_btn, close_btn]
                .spacing(0)
                .align_y(Alignment::Center),
        )
        .style(if active {
            theme::tab_active
        } else if hovered {
            theme::tab_hover
        } else {
            theme::tab_inactive
        });
        let cell = mouse_area(chip)
            .on_enter(Message::ProjectTabHoverEnter(pid.clone()))
            .on_exit(Message::ProjectTabHoverExit(pid));
        strip = strip.push(cell);
    }

    strip = strip.push(Space::new().width(Length::Fill));

    container(
        scrollable(strip).direction(scrollable::Direction::Horizontal(
            scrollable::Scrollbar::default()
                .width(4)
                .scroller_width(4),
        )),
    )
    .padding([theme::PAD_XS - 1.0, theme::PAD_SM])
    .width(Length::Fill)
    .style(theme::header_bar)
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
