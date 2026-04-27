use iced::widget::text_input as ti;
use iced::widget::{button, container};
use iced::{Background, Border, Color, Theme, border};

pub const BG: Color = Color::from_rgb(0.075, 0.082, 0.094);
pub const SURFACE: Color = Color::from_rgb(0.106, 0.118, 0.137);
pub const SURFACE_2: Color = Color::from_rgb(0.145, 0.161, 0.184);
pub const SURFACE_HOVER: Color = Color::from_rgb(0.180, 0.200, 0.227);
pub const BORDER: Color = Color::from_rgb(0.200, 0.220, 0.255);
pub const BORDER_STRONG: Color = Color::from_rgb(0.290, 0.320, 0.365);
pub const TEXT: Color = Color::from_rgb(0.905, 0.925, 0.950);
pub const TEXT_DIM: Color = Color::from_rgb(0.600, 0.635, 0.690);
pub const ACCENT: Color = Color::from_rgb(0.400, 0.700, 1.000);
pub const CLAUDE_ACCENT: Color = Color::from_rgb(0.760, 0.560, 1.000);
pub const SHELL_ACCENT: Color = Color::from_rgb(0.520, 0.560, 0.625);
pub const DANGER: Color = Color::from_rgb(0.950, 0.450, 0.450);

pub const PAD_XS: f32 = 4.0;
pub const PAD_SM: f32 = 8.0;
pub const PAD_MD: f32 = 12.0;
pub const PAD_LG: f32 = 16.0;
pub const RADIUS: f32 = 6.0;
pub const RADIUS_SM: f32 = 4.0;
pub const FONT_SIZE: f32 = 13.0;

pub fn panel(_: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(BG)),
        text_color: Some(TEXT),
        ..Default::default()
    }
}

pub fn card(_: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(SURFACE)),
        border: Border {
            color: BORDER,
            width: 1.0,
            radius: border::radius(RADIUS),
        },
        text_color: Some(TEXT),
        ..Default::default()
    }
}

pub fn sidebar(_: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(SURFACE)),
        border: Border {
            color: BORDER,
            width: 0.0,
            radius: border::radius(0.0),
        },
        text_color: Some(TEXT),
        ..Default::default()
    }
}

pub fn header_bar(_: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(SURFACE)),
        border: Border {
            color: BORDER,
            width: 0.0,
            radius: border::radius(0.0),
        },
        text_color: Some(TEXT),
        ..Default::default()
    }
}

pub fn tab_bar_bg(_: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(SURFACE_2)),
        text_color: Some(TEXT),
        ..Default::default()
    }
}

pub fn status_bar(_: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(SURFACE_2)),
        text_color: Some(TEXT_DIM),
        ..Default::default()
    }
}

pub fn error_bar(_: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(Color::from_rgb(0.32, 0.14, 0.14))),
        border: Border {
            color: DANGER,
            width: 1.0,
            radius: border::radius(0.0),
        },
        text_color: Some(Color::from_rgb(1.0, 0.88, 0.88)),
        ..Default::default()
    }
}

pub fn tab_active(_: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(BG)),
        border: Border {
            color: ACCENT,
            width: 1.0,
            radius: border::radius(RADIUS),
        },
        text_color: Some(TEXT),
        ..Default::default()
    }
}

pub fn tab_inactive(_: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(SURFACE)),
        border: Border {
            color: BORDER,
            width: 1.0,
            radius: border::radius(RADIUS),
        },
        text_color: Some(TEXT_DIM),
        ..Default::default()
    }
}

#[derive(Copy, Clone)]
pub enum ChipState {
    Active,
    Hover,
    Idle,
}

fn tab_chip(state: ChipState, accent: Color) -> container::Style {
    let (bg, border_color, text_color) = match state {
        ChipState::Active => (BG, accent, TEXT),
        ChipState::Hover => (SURFACE_HOVER, accent, TEXT),
        ChipState::Idle => (SURFACE, BORDER, TEXT_DIM),
    };
    container::Style {
        background: Some(Background::Color(bg)),
        border: Border {
            color: border_color,
            width: 1.0,
            radius: border::radius(RADIUS_SM),
        },
        text_color: Some(text_color),
        ..Default::default()
    }
}

pub fn tab_active_claude(_: &Theme) -> container::Style {
    tab_chip(ChipState::Active, CLAUDE_ACCENT)
}

pub fn tab_hover_claude(_: &Theme) -> container::Style {
    tab_chip(ChipState::Hover, CLAUDE_ACCENT)
}

pub fn tab_inactive_claude(_: &Theme) -> container::Style {
    tab_chip(ChipState::Idle, CLAUDE_ACCENT)
}

pub fn tab_active_shell(_: &Theme) -> container::Style {
    tab_chip(ChipState::Active, SHELL_ACCENT)
}

pub fn tab_hover_shell(_: &Theme) -> container::Style {
    tab_chip(ChipState::Hover, SHELL_ACCENT)
}

pub fn tab_inactive_shell(_: &Theme) -> container::Style {
    tab_chip(ChipState::Idle, SHELL_ACCENT)
}

pub fn tab_hover(_: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(SURFACE_HOVER)),
        border: Border {
            color: BORDER_STRONG,
            width: 1.0,
            radius: border::radius(RADIUS),
        },
        text_color: Some(TEXT),
        ..Default::default()
    }
}

pub fn flat_button(_: &Theme, status: button::Status) -> button::Style {
    let fg = match status {
        button::Status::Disabled => TEXT_DIM,
        _ => TEXT,
    };
    button::Style {
        background: None,
        text_color: fg,
        border: Border {
            color: Color::TRANSPARENT,
            width: 0.0,
            radius: border::radius(0.0),
        },
        ..Default::default()
    }
}

pub fn primary_button(_: &Theme, status: button::Status) -> button::Style {
    let (bg, fg) = match status {
        button::Status::Hovered => (Color::from_rgb(0.45, 0.75, 1.0), Color::WHITE),
        button::Status::Pressed => (Color::from_rgb(0.30, 0.60, 0.95), Color::WHITE),
        button::Status::Disabled => (Color::from_rgb(0.20, 0.22, 0.28), TEXT_DIM),
        _ => (ACCENT, Color::WHITE),
    };
    button::Style {
        background: Some(Background::Color(bg)),
        text_color: fg,
        border: Border {
            color: bg,
            width: 0.0,
            radius: border::radius(RADIUS),
        },
        ..Default::default()
    }
}

pub fn secondary_button(_: &Theme, status: button::Status) -> button::Style {
    let bg = match status {
        button::Status::Hovered => SURFACE_HOVER,
        button::Status::Pressed => SURFACE_2,
        button::Status::Disabled => SURFACE,
        _ => SURFACE_2,
    };
    button::Style {
        background: Some(Background::Color(bg)),
        text_color: TEXT,
        border: Border {
            color: BORDER_STRONG,
            width: 1.0,
            radius: border::radius(RADIUS),
        },
        ..Default::default()
    }
}

pub fn ghost_button(_: &Theme, status: button::Status) -> button::Style {
    let (bg, fg) = match status {
        button::Status::Hovered => (Some(Background::Color(SURFACE_HOVER)), TEXT),
        button::Status::Pressed => (Some(Background::Color(SURFACE_2)), TEXT),
        button::Status::Disabled => (None, TEXT_DIM),
        _ => (None, TEXT_DIM),
    };
    button::Style {
        background: bg,
        text_color: fg,
        border: Border {
            color: Color::TRANSPARENT,
            width: 0.0,
            radius: border::radius(RADIUS),
        },
        ..Default::default()
    }
}

pub fn danger_button(_: &Theme, status: button::Status) -> button::Style {
    let (bg, fg) = match status {
        button::Status::Hovered => (Color::from_rgb(0.60, 0.20, 0.20), Color::WHITE),
        button::Status::Pressed => (Color::from_rgb(0.50, 0.15, 0.15), Color::WHITE),
        button::Status::Disabled => (SURFACE, TEXT_DIM),
        _ => (Color::from_rgb(0.45, 0.15, 0.15), Color::from_rgb(1.0, 0.85, 0.85)),
    };
    button::Style {
        background: Some(Background::Color(bg)),
        text_color: fg,
        border: Border {
            color: DANGER,
            width: 1.0,
            radius: border::radius(RADIUS),
        },
        ..Default::default()
    }
}

pub fn modal_card(_: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(SURFACE)),
        border: Border {
            color: BORDER_STRONG,
            width: 1.0,
            radius: border::radius(RADIUS),
        },
        text_color: Some(TEXT),
        ..Default::default()
    }
}

pub fn terminal_frame(_: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(BG)),
        border: Border {
            color: BORDER,
            width: 1.0,
            radius: border::radius(RADIUS_SM),
        },
        text_color: Some(TEXT),
        ..Default::default()
    }
}

pub fn text_input(_: &Theme, status: ti::Status) -> ti::Style {
    let border_color = match status {
        ti::Status::Focused { .. } => ACCENT,
        ti::Status::Hovered => BORDER_STRONG,
        ti::Status::Disabled => BORDER,
        _ => BORDER,
    };
    ti::Style {
        background: Background::Color(BG),
        border: Border {
            color: border_color,
            width: 1.0,
            radius: border::radius(RADIUS_SM),
        },
        icon: TEXT_DIM,
        placeholder: TEXT_DIM,
        value: TEXT,
        selection: Color {
            a: 0.35,
            ..ACCENT
        },
    }
}

pub fn truncate_middle(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let keep = max.saturating_sub(1);
    let head = keep / 2;
    let tail = keep - head;
    let chars: Vec<char> = s.chars().collect();
    let head_s: String = chars.iter().take(head).collect();
    let tail_s: String = chars
        .iter()
        .rev()
        .take(tail)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("{}…{}", head_s, tail_s)
}
