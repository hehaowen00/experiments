use iced::widget::{button, container, row, scrollable, text, Space};
use iced::{Alignment, Element, Length};

use crate::app::App;
use crate::message::Message;
use crate::ui::theme;

pub fn view<'a>(app: &'a App) -> Element<'a, Message> {
    let home_active = app.active_project.is_none();
    let home_chip = container(
        button(text("Home").size(12))
            .padding([theme::PAD_XS + 2.0, theme::PAD_MD])
            .style(if home_active {
                theme::primary_button
            } else {
                theme::ghost_button
            })
            .on_press(Message::FocusProjectTab(None)),
    )
    .padding(2)
    .style(if home_active {
        theme::tab_active
    } else {
        theme::tab_inactive
    });

    let mut strip = row![home_chip]
        .spacing(theme::PAD_XS)
        .align_y(Alignment::Center);

    for state in &app.open_tabs {
        let active = app.active_project.as_deref() == Some(state.project.id.as_str());
        let label_btn = button(text(truncate(&state.project.name, 22)).size(12))
            .padding([theme::PAD_XS + 2.0, theme::PAD_SM + 2.0])
            .style(if active {
                theme::primary_button
            } else {
                theme::ghost_button
            })
            .on_press(Message::FocusProjectTab(Some(state.project.id.clone())));
        let close_btn = button(text("×").size(12))
            .padding([theme::PAD_XS, theme::PAD_SM])
            .style(theme::ghost_button)
            .on_press(Message::CloseProjectTab(state.project.id.clone()));
        let chip = container(
            row![label_btn, close_btn]
                .spacing(2)
                .align_y(Alignment::Center),
        )
        .padding(2)
        .style(if active {
            theme::tab_active
        } else {
            theme::tab_inactive
        });
        strip = strip.push(chip);
    }

    let plus = button(text("+").size(13))
        .padding([theme::PAD_XS + 2.0, theme::PAD_MD])
        .style(theme::ghost_button)
        .on_press(Message::FocusProjectTab(None));
    strip = strip.push(plus).push(Space::new().width(Length::Fill));

    container(
        scrollable(strip).direction(scrollable::Direction::Horizontal(
            scrollable::Scrollbar::default()
                .width(4)
                .scroller_width(4),
        )),
    )
    .padding([theme::PAD_XS + 2.0, theme::PAD_SM])
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
