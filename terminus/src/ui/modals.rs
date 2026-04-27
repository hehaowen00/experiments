use iced::widget::{
    button, checkbox, column, container, mouse_area, row, stack, text, text_input, Space,
};
use iced::{Alignment, Background, Color, Element, Length};

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
    let dimmer = mouse_area(dimmer).on_press(Message::CloseModal);

    let centered = container(modal)
        .center_x(Length::Fill)
        .center_y(Length::Fill);

    stack![base, dimmer, centered].into()
}

pub fn add_worktree<'a>(m: &'a Modal) -> Element<'a, Message> {
    let content = column![
        text("Add worktree").size(theme::FONT_SIZE),
        column![
            text("Branch").size(theme::FONT_SIZE).color(theme::TEXT_DIM),
            text_input("feature/my-thing", &m.branch)
                .on_input(Message::AddWtBranchChanged)
                .padding(8)
                .style(theme::text_input),
            checkbox(m.new_branch)
                .label("Create new branch")
                .on_toggle(Message::AddWtNewBranchToggled),
        ]
        .spacing(theme::PAD_XS + 2.0),
        column![
            text("Path").size(theme::FONT_SIZE).color(theme::TEXT_DIM),
            row![
                text_input("/path/to/new/worktree", &m.path)
                    .on_input(Message::AddWtPathChanged)
                    .padding(8)
                    .style(theme::text_input),
                button(text("Browse").size(theme::FONT_SIZE))
                    .padding([theme::PAD_SM, theme::PAD_MD])
                    .style(theme::secondary_button)
                    .on_press(Message::AddWtBrowsePath),
            ]
            .spacing(theme::PAD_SM)
            .align_y(Alignment::Center),
        ]
        .spacing(theme::PAD_XS + 2.0),
        checkbox(m.force).label("Force").on_toggle(Message::AddWtForceToggled),
        Space::new().height(Length::Fixed(theme::PAD_SM)),
        row![
            Space::new().width(Length::Fill),
            button(text("Cancel").size(theme::FONT_SIZE))
                .padding([theme::PAD_SM, theme::PAD_MD])
                .style(theme::secondary_button)
                .on_press(Message::CloseModal),
            button(text("Create").size(theme::FONT_SIZE))
                .padding([theme::PAD_SM, theme::PAD_MD])
                .style(theme::primary_button)
                .on_press(Message::AddWtSubmit),
        ]
        .spacing(theme::PAD_SM)
        .align_y(Alignment::Center),
    ]
    .spacing(theme::PAD_MD);

    container(content)
        .padding(theme::PAD_LG)
        .width(Length::Fixed(460.0))
        .style(theme::modal_card)
        .into()
}
