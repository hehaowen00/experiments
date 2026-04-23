use iced::widget::{button, column, container, row, scrollable, text, Space};
use iced::{Alignment, Element, Length};

use crate::app::ProjectState;
use crate::message::Message;
use crate::ui::theme;

pub fn view<'a>(state: &'a ProjectState) -> Element<'a, Message> {
    let header = container(
        row![
            text("Worktrees").size(13),
            Space::new().width(Length::Fill),
            button(text("+").size(13))
                .padding([theme::PAD_XS, theme::PAD_SM + 2.0])
                .style(theme::ghost_button)
                .on_press(Message::OpenAddWorktreeModal),
            button(text("prune").size(11))
                .padding([theme::PAD_XS, theme::PAD_SM])
                .style(theme::ghost_button)
                .on_press(Message::PruneWorktreesClicked),
        ]
        .align_y(Alignment::Center)
        .spacing(theme::PAD_XS)
        .padding([theme::PAD_SM + 2.0, theme::PAD_MD]),
    )
    .width(Length::Fill);

    let mut list = column![]
        .spacing(theme::PAD_XS)
        .padding([theme::PAD_XS, theme::PAD_SM]);

    for wt in &state.worktrees {
        let label = wt.display_label();
        let selected = state.selected_wt.as_ref() == Some(&wt.path);
        let marker = if wt.is_main { " ·" } else { "" };
        let label_text = text(format!("{}{}", label, marker)).size(12);

        let select_btn = button(label_text)
            .padding([theme::PAD_XS + 2.0, theme::PAD_SM + 2.0])
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
                button(text("×").size(12))
                    .padding([theme::PAD_XS, theme::PAD_SM - 2.0])
                    .style(theme::ghost_button)
                    .on_press(Message::RemoveWorktreeClicked(wt.path.clone())),
            ]
            .spacing(theme::PAD_XS)
            .align_y(Alignment::Center)
            .into()
        };

        list = list.push(row_content);
    }

    let panel = column![header, scrollable(list).height(Length::Fill)]
        .width(Length::Fixed(240.0))
        .height(Length::Fill);

    container(panel)
        .width(Length::Fixed(240.0))
        .height(Length::Fill)
        .style(theme::sidebar)
        .into()
}
