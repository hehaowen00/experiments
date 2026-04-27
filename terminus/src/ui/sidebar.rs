use iced::widget::{button, column, container, row, scrollable, text, Space};
use iced::{Alignment, Element, Length};

use crate::app::ProjectState;
use crate::message::Message;
use crate::ui::theme;

pub fn view<'a>(state: &'a ProjectState) -> Element<'a, Message> {
    let header = container(
        row![
            text("Worktrees").size(theme::FONT_SIZE).color(theme::TEXT_DIM),
            Space::new().width(Length::Fill),
            button(text("+").size(theme::FONT_SIZE))
                .padding([0.0, theme::PAD_XS + 2.0])
                .style(theme::ghost_button)
                .on_press(Message::OpenAddWorktreeModal),
            button(text("prune").size(theme::FONT_SIZE))
                .padding([0.0, theme::PAD_XS + 2.0])
                .style(theme::ghost_button)
                .on_press(Message::PruneWorktreesClicked),
        ]
        .align_y(Alignment::Center)
        .spacing(2.0)
        .padding([theme::PAD_XS + 1.0, theme::PAD_SM]),
    )
    .width(Length::Fill);

    let mut list = column![]
        .spacing(1.0)
        .padding([theme::PAD_XS - 2.0, theme::PAD_XS + 1.0]);

    for wt in &state.worktrees {
        let label = wt.display_label();
        let selected = state.selected_wt.as_ref() == Some(&wt.path);
        let label_row = if wt.is_main {
            row![
                text(label).size(theme::FONT_SIZE),
                Space::new().width(Length::Fill),
                text("main").size(theme::FONT_SIZE).color(theme::TEXT_DIM),
            ]
            .align_y(Alignment::Center)
        } else {
            row![text(label).size(theme::FONT_SIZE)].align_y(Alignment::Center)
        };

        let select_btn = button(label_row)
            .padding([theme::PAD_XS, theme::PAD_SM])
            .width(Length::Fill)
            .style(if selected {
                theme::primary_button
            } else {
                theme::ghost_button
            })
            .on_press(Message::SelectWorktree(wt.path.clone()));

        let row_content: Element<'_, Message> = if wt.is_main {
            row![select_btn].align_y(Alignment::Center).into()
        } else {
            row![
                select_btn,
                button(text("×").size(theme::FONT_SIZE).color(theme::TEXT_DIM))
                    .padding([theme::PAD_XS - 2.0, theme::PAD_XS])
                    .style(theme::ghost_button)
                    .on_press(Message::RemoveWorktreeClicked(wt.path.clone())),
            ]
            .spacing(1.0)
            .align_y(Alignment::Center)
            .into()
        };

        list = list.push(row_content);
    }

    let panel = column![header, scrollable(list).height(Length::Fill)]
        .width(Length::Fixed(200.0))
        .height(Length::Fill);

    container(panel)
        .width(Length::Fixed(200.0))
        .height(Length::Fill)
        .style(theme::sidebar)
        .into()
}
