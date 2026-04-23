use iced::widget::container;
use iced::{Element, Length};

use crate::app::Tab;
use crate::message::Message;

pub fn view<'a>(tab: &'a Tab) -> Element<'a, Message> {
    let id = tab.id;
    container(iced_term::TerminalView::show(&tab.term).map(move |e| Message::Terminal(id, e)))
        .width(Length::Fill)
        .height(Length::Fill)
        .into()
}
