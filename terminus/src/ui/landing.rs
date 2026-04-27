use iced::widget::{button, column, container, mouse_area, row, scrollable, text, Space};
use iced::{Alignment, Element, Length};

use crate::app::App;
use crate::message::Message;
use crate::ui::theme;

pub fn view<'a>(app: &'a App) -> Element<'a, Message> {
    let header = container(
        row![
            Space::new().width(Length::Fill),
            button(text("+ project").size(theme::FONT_SIZE))
                .padding([theme::PAD_SM, theme::PAD_MD])
                .style(theme::primary_button)
                .on_press(Message::AddProjectClicked),
        ]
        .align_y(Alignment::Center)
        .spacing(theme::PAD_SM)
        .padding([theme::PAD_SM, theme::PAD_LG]),
    )
    .width(Length::Fill);

    let body: Element<'_, Message> = if app.projects.is_empty() {
        container(
            column![
                text("No projects yet").size(theme::FONT_SIZE),
                text("Click \"+ Add project\" to pick a folder.")
                    .size(theme::FONT_SIZE)
                    .color(theme::TEXT_DIM),
            ]
            .spacing(theme::PAD_SM)
            .align_x(Alignment::Center),
        )
        .center_x(Length::Fill)
        .center_y(Length::Fill)
        .into()
    } else {
        let mut col = column![]
            .spacing(theme::PAD_SM)
            .padding([theme::PAD_MD, theme::PAD_LG]);
        for p in &app.projects {
            let path_str = theme::truncate_middle(&p.path.to_string_lossy(), 88);
            let already_open = app.open_tabs.iter().any(|s| s.project.id == p.id);
            let last_used = p
                .last_used
                .as_deref()
                .and_then(|s| s.split_whitespace().next())
                .unwrap_or("never");
            let mut meta = row![
                text(path_str).size(theme::FONT_SIZE).color(theme::TEXT_DIM),
                text(format!("· {}", last_used))
                    .size(theme::FONT_SIZE)
                    .color(theme::TEXT_DIM),
            ]
            .spacing(theme::PAD_SM)
            .align_y(Alignment::Center);
            if already_open {
                meta = meta.push(text("· open").size(theme::FONT_SIZE).color(theme::ACCENT));
            }
            let card_inner = container(
                row![
                    column![text(p.name.clone()).size(theme::FONT_SIZE), meta,]
                        .spacing(2)
                        .width(Length::Fill),
                    button(text("×").size(theme::FONT_SIZE).color(theme::TEXT_DIM))
                        .padding([theme::PAD_XS - 2.0, theme::PAD_XS + 1.0])
                        .style(theme::ghost_button)
                        .on_press(Message::RemoveProject(p.id.clone())),
                ]
                .spacing(theme::PAD_SM)
                .align_y(Alignment::Center),
            )
            .padding([theme::PAD_MD, theme::PAD_LG])
            .width(Length::Fill)
            .style(theme::card);
            let card = mouse_area(card_inner)
                .on_press(Message::OpenProject(p.id.clone()))
                .interaction(iced::mouse::Interaction::Pointer);
            col = col.push(card);
        }
        scrollable(col).height(Length::Fill).into()
    };

    column![header, body]
        .spacing(0)
        .width(Length::Fill)
        .height(Length::Fill)
        .into()
}

pub fn error_banner<'a>(err: &'a Option<String>) -> Element<'a, Message> {
    match err {
        Some(msg) => container(
            row![
                text("⚠").size(theme::FONT_SIZE).color(theme::DANGER),
                container(text(theme::truncate_middle(msg, 140)).size(theme::FONT_SIZE))
                    .max_width(720.0),
                Space::new().width(Length::Fill),
                button(text("Dismiss").size(theme::FONT_SIZE))
                    .padding([theme::PAD_XS, theme::PAD_SM])
                    .style(theme::ghost_button)
                    .on_press(Message::DismissError),
            ]
            .spacing(theme::PAD_SM)
            .align_y(Alignment::Center),
        )
        .padding([theme::PAD_SM, theme::PAD_LG])
        .width(Length::Fill)
        .style(theme::error_bar)
        .into(),
        None => Space::new().height(Length::Fixed(0.0)).into(),
    }
}
