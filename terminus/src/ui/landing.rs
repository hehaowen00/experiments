use iced::widget::{button, column, container, row, scrollable, text, Space};
use iced::{Alignment, Element, Length};

use crate::app::App;
use crate::message::Message;
use crate::ui::theme;

pub fn view<'a>(app: &'a App) -> Element<'a, Message> {
    let header = container(
        row![
            text("Projects").size(18),
            Space::new().width(Length::Fill),
            button(text("+ Add project").size(13))
                .padding([theme::PAD_SM, theme::PAD_MD])
                .style(theme::primary_button)
                .on_press(Message::AddProjectClicked),
        ]
        .align_y(Alignment::Center)
        .spacing(theme::PAD_MD)
        .padding([theme::PAD_SM + 2.0, theme::PAD_LG]),
    )
    .width(Length::Fill);

    let body: Element<'_, Message> = if app.projects.is_empty() {
        container(
            column![
                text("No projects yet").size(18),
                text("Click \"+ Add project\" to pick a folder.")
                    .size(13)
                    .color(theme::TEXT_DIM),
            ]
            .spacing(theme::PAD_SM)
            .align_x(Alignment::Center),
        )
        .center_x(Length::Fill)
        .center_y(Length::Fill)
        .into()
    } else {
        let mut col = column![].spacing(theme::PAD_SM).padding(theme::PAD_LG);
        for p in &app.projects {
            let path_str = theme::truncate_middle(&p.path.to_string_lossy(), 72);
            let already_open = app.open_tabs.iter().any(|s| s.project.id == p.id);
            let card = container(
                row![
                    column![
                        text(p.name.clone()).size(15),
                        text(path_str).size(11).color(theme::TEXT_DIM),
                    ]
                    .spacing(3)
                    .width(Length::Fill),
                    row![
                        button(text(if already_open { "Focus" } else { "Open" }).size(12))
                            .padding([theme::PAD_XS + 2.0, theme::PAD_MD])
                            .style(theme::primary_button)
                            .on_press(Message::OpenProject(p.id.clone())),
                        button(text("Remove").size(12))
                            .padding([theme::PAD_XS + 2.0, theme::PAD_MD])
                            .style(theme::danger_button)
                            .on_press(Message::RemoveProject(p.id.clone())),
                    ]
                    .spacing(theme::PAD_SM)
                    .align_y(Alignment::Center),
                ]
                .spacing(theme::PAD_MD)
                .align_y(Alignment::Center),
            )
            .padding([theme::PAD_MD, theme::PAD_LG])
            .width(Length::Fill)
            .height(Length::Fixed(68.0))
            .style(theme::card);
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
                text(msg.clone()).size(12),
                Space::new().width(Length::Fill),
                button(text("Dismiss").size(11))
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
