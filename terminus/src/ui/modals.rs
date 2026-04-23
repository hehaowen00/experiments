use iced::widget::{button, checkbox, column, container, row, stack, text, text_input, Space};
use iced::{Alignment, Background, Border, Color, Element, Length};

use crate::app::Modal;
use crate::message::Message;
use crate::ui::theme;

pub fn overlay<'a>(
    base: Element<'a, Message>,
    modal: Element<'a, Message>,
) -> Element<'a, Message> {
    let dimmer = container(Space::new().height(Length::Fill))
        .width(Length::Fill)
        .height(Length::Fill)
        .style(|_t: &iced::Theme| container::Style {
            background: Some(Background::Color(Color {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 0.55,
            })),
            ..Default::default()
        });

    let centered = container(modal)
        .center_x(Length::Fill)
        .center_y(Length::Fill);

    stack![base, dimmer, centered].into()
}

pub fn add_worktree<'a>(m: &'a Modal) -> Element<'a, Message> {
    let content = column![
        text("Add worktree").size(18),
        Space::new().height(Length::Fixed(8.0)),
        text("Branch").size(12),
        text_input("feature/my-thing", &m.branch)
            .on_input(Message::AddWtBranchChanged)
            .padding(6),
        checkbox(m.new_branch)
            .label("Create new branch")
            .on_toggle(Message::AddWtNewBranchToggled),
        Space::new().height(Length::Fixed(6.0)),
        text("Path").size(12),
        row![
            text_input("/path/to/new/worktree", &m.path)
                .on_input(Message::AddWtPathChanged)
                .padding(6),
            button(text("Browse")).on_press(Message::AddWtBrowsePath),
        ]
        .spacing(6)
        .align_y(Alignment::Center),
        Space::new().height(Length::Fixed(4.0)),
        checkbox(m.force).label("Force").on_toggle(Message::AddWtForceToggled),
        Space::new().height(Length::Fixed(12.0)),
        row![
            Space::new().width(Length::Fill),
            button(text("Cancel")).on_press(Message::CloseModal),
            button(text("Create")).on_press(Message::AddWtSubmit),
        ]
        .spacing(8)
        .align_y(Alignment::Center),
    ]
    .spacing(6);

    container(content)
        .padding(20)
        .width(Length::Fixed(460.0))
        .style(|_t: &iced::Theme| container::Style {
            background: Some(Background::Color(theme::SURFACE)),
            border: Border {
                color: theme::BORDER,
                width: 1.0,
                radius: iced::border::radius(8),
            },
            text_color: Some(theme::TEXT),
            ..Default::default()
        })
        .into()
}
