use iced::widget::container;
use iced::{Element, Length};

use crate::app::Tab;
use crate::message::Message;
use crate::ui::theme;

pub fn view<'a>(tab: &'a Tab) -> Element<'a, Message> {
    let id = tab.id;
    let inner = container(
        iced_term::TerminalView::show(&tab.term).map(move |e| Message::Terminal(id, e)),
    )
    .style(theme::terminal_frame)
    .width(Length::Fill)
    .height(Length::Fill);

    container(inner)
        .padding([theme::PAD_XS, theme::PAD_SM])
        .width(Length::Fill)
        .height(Length::Fill)
        .into()
}
