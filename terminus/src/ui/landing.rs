use iced::widget::{button, column, container, mouse_area, row, scrollable, text, Space};
use iced::{Alignment, Element, Length};

use crate::app::App;
use crate::message::Message;
use crate::ui::theme;

pub fn view<'a>(app: &'a App) -> Element<'a, Message> {
    let project_count = app.projects.len();
    let project_label = match project_count {
        0 => "No projects saved".to_string(),
        1 => "1 project saved".to_string(),
        n => format!("{n} projects saved"),
    };

    let header = container(
        row![
            column![
                text("Terminus").size(theme::FONT_LG),
                text(project_label)
                    .size(theme::FONT_SM)
                    .color(theme::TEXT_DIM),
            ]
            .spacing(2)
            .width(Length::Fill),
            button(text("+ project").size(theme::FONT_SIZE))
                .padding([theme::PAD_SM, theme::PAD_MD])
                .style(theme::primary_button)
                .on_press(Message::AddProjectClicked),
        ]
        .align_y(Alignment::Center)
        .spacing(theme::PAD_SM)
        .padding([theme::PAD_MD, theme::PAD_XL]),
    )
    .width(Length::Fill);

    let body: Element<'_, Message> = if app.projects.is_empty() {
        let empty = container(
            column![
                text("PROJECTS").size(theme::FONT_SM).color(theme::ACCENT),
                text("No projects yet").size(22.0),
                text("Add a folder to open terminals, worktrees, and Claude sessions from one place.")
                    .size(theme::FONT_SIZE)
                    .color(theme::TEXT_DIM),
                button(text("+ project").size(theme::FONT_SIZE))
                    .padding([theme::PAD_SM, theme::PAD_MD])
                    .style(theme::primary_button)
                    .on_press(Message::AddProjectClicked),
            ]
            .spacing(theme::PAD_MD)
            .align_x(Alignment::Center),
        )
        .padding(theme::PAD_XL)
        .max_width(520.0)
        .style(theme::empty_card);

        container(empty)
            .center_x(Length::Fill)
            .center_y(Length::Fill)
            .into()
    } else {
        let mut col = column![]
            .spacing(theme::PAD_SM)
            .padding([theme::PAD_MD, theme::PAD_LG]);
        for p in &app.projects {
            let path_str = theme::truncate_middle(&p.path.to_string_lossy(), 96);
            let already_open = app.open_tabs.iter().any(|s| s.project.id == p.id);
            let last_used = p
                .last_used
                .as_deref()
                .and_then(|s| s.split_whitespace().next())
                .unwrap_or("never");
            let open_badge =
                container(text(if already_open { "open" } else { "saved" }).size(theme::FONT_SM))
                    .padding([2.0, theme::PAD_SM])
                    .style(if already_open {
                        theme::badge_accent
                    } else {
                        theme::badge
                    });
            let used_badge = container(text(format!("used {last_used}")).size(theme::FONT_SM))
                .padding([2.0, theme::PAD_SM])
                .style(theme::badge);
            let meta = row![
                text(path_str).size(theme::FONT_SM).color(theme::TEXT_DIM),
                Space::new().width(Length::Fill),
                used_badge,
                open_badge,
            ]
            .spacing(theme::PAD_SM)
            .align_y(Alignment::Center);
            let card_inner = container(
                row![
                    container(Space::new())
                        .width(Length::Fixed(3.0))
                        .height(Length::Fixed(46.0))
                        .style(theme::accent_bar),
                    column![text(p.name.clone()).size(15.0), meta,]
                        .spacing(theme::PAD_XS)
                        .width(Length::Fill),
                    button(text("×").size(16.0).color(theme::TEXT_MUTED))
                        .padding([theme::PAD_XS, theme::PAD_SM])
                        .style(theme::ghost_button)
                        .on_press(Message::RemoveProject(p.id.clone())),
                ]
                .spacing(theme::PAD_MD)
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
