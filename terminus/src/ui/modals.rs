use iced::widget::{
    button, checkbox, column, container, mouse_area, row, stack, text, text_input, Space,
};
use iced::{Alignment, Element, Length};

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
        .style(theme::modal_dimmer);
    let dimmer = mouse_area(dimmer).on_press(Message::CloseModal);

    let centered = container(modal)
        .center_x(Length::Fill)
        .center_y(Length::Fill);

    stack![base, dimmer, centered].into()
}

pub fn add_worktree<'a>(m: &'a Modal) -> Element<'a, Message> {
    let content = column![
        column![
            text("Add worktree").size(theme::FONT_LG),
            text("Create or attach a worktree for the current repository.")
                .size(theme::FONT_SIZE)
                .color(theme::TEXT_DIM),
        ]
        .spacing(2),
        column![
            text("BRANCH").size(theme::FONT_SM).color(theme::TEXT_DIM),
            text_input("feature/my-thing", &m.branch)
                .on_input(Message::AddWtBranchChanged)
                .padding(theme::PAD_SM)
                .style(theme::text_input),
            checkbox(m.new_branch)
                .label("Create new branch")
                .on_toggle(Message::AddWtNewBranchToggled)
                .style(theme::checkbox),
        ]
        .spacing(theme::PAD_SM),
        column![
            text("PATH").size(theme::FONT_SM).color(theme::TEXT_DIM),
            row![
                text_input("/path/to/new/worktree", &m.path)
                    .on_input(Message::AddWtPathChanged)
                    .padding(theme::PAD_SM)
                    .width(Length::Fill)
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
        checkbox(m.force)
            .label("Force")
            .on_toggle(Message::AddWtForceToggled)
            .style(theme::checkbox),
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
        .padding(theme::PAD_XL)
        .width(Length::Fixed(500.0))
        .style(theme::modal_card)
        .into()
}
