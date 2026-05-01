use std::path::Path;

use iced::widget::{button, column, container, row, scrollable, text, Space};
use iced::{Alignment, Element, Length};

use crate::app::ProjectState;
use crate::message::Message;
use crate::ui::theme;

pub fn view<'a>(state: &'a ProjectState) -> Element<'a, Message> {
    let project_header = container(
        row![
            text("PROJECT").size(theme::FONT_SM).color(theme::TEXT_DIM),
            Space::new().width(Length::Fill),
            button(text("+ folder").size(theme::FONT_SM))
                .padding([theme::PAD_XS - 1.0, theme::PAD_SM])
                .style(theme::ghost_button)
                .on_press(Message::AddProjectFolderClicked),
        ]
        .align_y(Alignment::Center)
        .spacing(theme::PAD_XS)
        .padding([theme::PAD_SM, theme::PAD_MD]),
    )
    .width(Length::Fill);

    let root_selected = state.selected_wt.is_none();
    let root_row = row![
        text(state.project.name.clone()).size(theme::FONT_SIZE),
        Space::new().width(Length::Fill),
        container(text("root").size(theme::FONT_SM))
            .padding([1.0, theme::PAD_XS + 2.0])
            .style(theme::badge_accent),
    ]
    .align_y(Alignment::Center)
    .spacing(theme::PAD_SM);
    let root_btn = button(root_row)
        .padding([theme::PAD_XS + 2.0, theme::PAD_SM])
        .width(Length::Fill)
        .style(if root_selected {
            theme::selected_button
        } else {
            theme::ghost_button
        })
        .on_press(Message::SelectProjectRoot);

    let mut project_list = column![root_btn]
        .spacing(theme::PAD_XS)
        .padding([theme::PAD_XS, theme::PAD_SM]);

    for folder in &state.project_folders {
        let selected = state.selected_wt.as_ref() == Some(folder);
        let label = folder_label(folder, &state.project.path);
        let select_btn = button(
            row![
                text(label).size(theme::FONT_SIZE),
                Space::new().width(Length::Fill),
            ]
            .align_y(Alignment::Center),
        )
        .padding([theme::PAD_XS + 2.0, theme::PAD_SM])
        .width(Length::Fill)
        .style(if selected {
            theme::selected_button
        } else {
            theme::ghost_button
        })
        .on_press(Message::SelectProjectFolder(folder.clone()));

        project_list = project_list.push(
            row![
                select_btn,
                button(text("×").size(15.0).color(theme::TEXT_MUTED))
                    .padding([theme::PAD_XS, theme::PAD_SM])
                    .style(theme::ghost_button)
                    .on_press(Message::RemoveProjectFolderClicked(folder.clone())),
            ]
            .spacing(1.0)
            .align_y(Alignment::Center),
        );
    }

    let mut panel = column![project_header, project_list].width(Length::Fixed(220.0));

    if state.is_git_repo {
        let worktree_header = container(
            row![
                text("WORKTREES")
                    .size(theme::FONT_SM)
                    .color(theme::TEXT_DIM),
                Space::new().width(Length::Fill),
                button(text("+").size(theme::FONT_SIZE))
                    .padding([theme::PAD_XS - 1.0, theme::PAD_SM])
                    .style(theme::ghost_button)
                    .on_press(Message::OpenAddWorktreeModal),
                button(text("prune").size(theme::FONT_SM))
                    .padding([theme::PAD_XS - 1.0, theme::PAD_SM])
                    .style(theme::ghost_button)
                    .on_press(Message::PruneWorktreesClicked),
            ]
            .align_y(Alignment::Center)
            .spacing(theme::PAD_XS)
            .padding([theme::PAD_SM, theme::PAD_MD]),
        )
        .width(Length::Fill);

        let mut worktree_list = column![]
            .spacing(theme::PAD_XS)
            .padding([theme::PAD_XS, theme::PAD_SM]);

        for wt in &state.worktrees {
            let label = wt.display_label();
            let selected = state.selected_wt.as_ref() == Some(&wt.path);
            let mut label_row = row![text(label).size(theme::FONT_SIZE)]
                .align_y(Alignment::Center)
                .spacing(theme::PAD_SM);
            label_row = label_row.push(Space::new().width(Length::Fill));
            if wt.is_main {
                label_row = label_row.push(
                    container(text("main").size(theme::FONT_SM))
                        .padding([1.0, theme::PAD_XS + 2.0])
                        .style(theme::badge_warm),
                );
            }

            let select_btn = button(label_row)
                .padding([theme::PAD_XS + 2.0, theme::PAD_SM])
                .width(Length::Fill)
                .style(if selected {
                    theme::selected_button
                } else {
                    theme::ghost_button
                })
                .on_press(Message::SelectWorktree(wt.path.clone()));

            let row_content: Element<'_, Message> = if wt.is_main {
                row![select_btn].align_y(Alignment::Center).into()
            } else {
                row![
                    select_btn,
                    button(text("×").size(15.0).color(theme::TEXT_MUTED))
                        .padding([theme::PAD_XS, theme::PAD_SM])
                        .style(theme::ghost_button)
                        .on_press(Message::RemoveWorktreeClicked(wt.path.clone())),
                ]
                .spacing(1.0)
                .align_y(Alignment::Center)
                .into()
            };

            worktree_list = worktree_list.push(row_content);
        }

        panel = panel.push(worktree_header).push(worktree_list);
    }

    let panel = panel.height(Length::Fill);

    container(scrollable(panel).height(Length::Fill))
        .width(Length::Fixed(220.0))
        .height(Length::Fill)
        .style(theme::sidebar)
        .into()
}

fn folder_label(path: &Path, root: &Path) -> String {
    path.strip_prefix(root)
        .ok()
        .filter(|p| !p.as_os_str().is_empty())
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| {
            path.file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("(folder)")
                .to_string()
        })
}
