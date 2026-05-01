use iced::widget::text_input as ti;
use iced::widget::{button, checkbox as cb, container};
use iced::{border, Background, Border, Color, Shadow, Theme, Vector};

pub const BG: Color = Color::from_rgb(0.045, 0.050, 0.052);
pub const BG_RAISED: Color = Color::from_rgb(0.062, 0.069, 0.071);
pub const SURFACE: Color = Color::from_rgb(0.082, 0.090, 0.092);
pub const SURFACE_2: Color = Color::from_rgb(0.112, 0.123, 0.126);
pub const SURFACE_HOVER: Color = Color::from_rgb(0.150, 0.165, 0.166);
pub const BORDER: Color = Color::from_rgb(0.215, 0.238, 0.235);
pub const BORDER_STRONG: Color = Color::from_rgb(0.340, 0.375, 0.360);
pub const TEXT: Color = Color::from_rgb(0.925, 0.930, 0.910);
pub const TEXT_DIM: Color = Color::from_rgb(0.615, 0.650, 0.630);
pub const TEXT_MUTED: Color = Color::from_rgb(0.435, 0.465, 0.455);
pub const ACCENT: Color = Color::from_rgb(0.180, 0.780, 0.690);
pub const ACCENT_STRONG: Color = Color::from_rgb(0.260, 0.900, 0.780);
pub const CLAUDE_ACCENT: Color = Color::from_rgb(0.940, 0.610, 0.340);
pub const SHELL_ACCENT: Color = Color::from_rgb(0.460, 0.700, 0.920);
pub const SUCCESS: Color = Color::from_rgb(0.450, 0.820, 0.520);
pub const WARNING: Color = Color::from_rgb(0.900, 0.690, 0.330);
pub const DANGER: Color = Color::from_rgb(0.960, 0.390, 0.380);

pub const PAD_XS: f32 = 4.0;
pub const PAD_SM: f32 = 8.0;
pub const PAD_MD: f32 = 12.0;
pub const PAD_LG: f32 = 16.0;
pub const PAD_XL: f32 = 24.0;
pub const RADIUS: f32 = 8.0;
pub const RADIUS_SM: f32 = 5.0;
pub const FONT_SIZE: f32 = 13.0;
pub const FONT_SM: f32 = 12.0;
pub const FONT_LG: f32 = 18.0;

fn alpha(color: Color, a: f32) -> Color {
    Color { a, ..color }
}

fn lift(a: f32, y: f32, blur: f32) -> Shadow {
    Shadow {
        color: Color {
            r: 0.0,
            g: 0.0,
            b: 0.0,
            a,
        },
        offset: Vector::new(0.0, y),
        blur_radius: blur,
    }
}

pub fn app_theme() -> Theme {
    Theme::custom(
        "Terminus",
        iced::theme::Palette {
            background: BG,
            text: TEXT,
            primary: ACCENT,
            success: SUCCESS,
            warning: WARNING,
            danger: DANGER,
        },
    )
}

pub fn terminal_palette() -> iced_term::ColorPalette {
    iced_term::ColorPalette {
        foreground: "#ecefe7".into(),
        background: "#0b0f0f".into(),
        black: "#111616".into(),
        red: "#e05f5c".into(),
        green: "#7acb75".into(),
        yellow: "#e3b55d".into(),
        blue: "#74a8d8".into(),
        magenta: "#c58bd8".into(),
        cyan: "#54d3c0".into(),
        white: "#d7ddd6".into(),
        bright_black: "#59615f".into(),
        bright_red: "#ff7772".into(),
        bright_green: "#9be592".into(),
        bright_yellow: "#ffd37b".into(),
        bright_blue: "#92c3f0".into(),
        bright_magenta: "#dba5f0".into(),
        bright_cyan: "#74eddc".into(),
        bright_white: "#fbfff7".into(),
        bright_foreground: Some("#fbfff7".into()),
        dim_foreground: "#858d89".into(),
        dim_black: "#080b0b".into(),
        dim_red: "#823837".into(),
        dim_green: "#476f45".into(),
        dim_yellow: "#806438".into(),
        dim_blue: "#405f78".into(),
        dim_magenta: "#694a73".into(),
        dim_cyan: "#347a71".into(),
        dim_white: "#8b918c".into(),
    }
}

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
        shadow: lift(0.22, 5.0, 18.0),
        text_color: Some(TEXT),
        ..Default::default()
    }
}

pub fn empty_card(_: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(BG_RAISED)),
        border: Border {
            color: alpha(BORDER_STRONG, 0.65),
            width: 1.0,
            radius: border::radius(RADIUS),
        },
        shadow: lift(0.28, 10.0, 28.0),
        text_color: Some(TEXT),
        ..Default::default()
    }
}

pub fn accent_bar(_: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(ACCENT)),
        border: Border {
            color: ACCENT,
            width: 0.0,
            radius: border::radius(RADIUS_SM),
        },
        ..Default::default()
    }
}

pub fn badge(_: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(SURFACE_2)),
        border: Border {
            color: BORDER,
            width: 1.0,
            radius: border::radius(RADIUS_SM),
        },
        text_color: Some(TEXT_DIM),
        ..Default::default()
    }
}

pub fn badge_accent(_: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(alpha(ACCENT, 0.12))),
        border: Border {
            color: alpha(ACCENT, 0.38),
            width: 1.0,
            radius: border::radius(RADIUS_SM),
        },
        text_color: Some(ACCENT_STRONG),
        ..Default::default()
    }
}

pub fn badge_warm(_: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(alpha(CLAUDE_ACCENT, 0.12))),
        border: Border {
            color: alpha(CLAUDE_ACCENT, 0.35),
            width: 1.0,
            radius: border::radius(RADIUS_SM),
        },
        text_color: Some(CLAUDE_ACCENT),
        ..Default::default()
    }
}

pub fn sidebar(_: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(BG_RAISED)),
        border: Border {
            color: alpha(BORDER, 0.72),
            width: 1.0,
            radius: border::radius(0.0),
        },
        text_color: Some(TEXT),
        ..Default::default()
    }
}

pub fn header_bar(_: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(BG_RAISED)),
        border: Border {
            color: alpha(BORDER, 0.60),
            width: 1.0,
            radius: border::radius(0.0),
        },
        shadow: lift(0.18, 2.0, 12.0),
        text_color: Some(TEXT),
        ..Default::default()
    }
}

pub fn tab_bar_bg(_: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(SURFACE)),
        border: Border {
            color: alpha(BORDER, 0.50),
            width: 1.0,
            radius: border::radius(0.0),
        },
        text_color: Some(TEXT),
        ..Default::default()
    }
}

pub fn status_bar(_: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(BG_RAISED)),
        border: Border {
            color: alpha(BORDER, 0.55),
            width: 1.0,
            radius: border::radius(0.0),
        },
        text_color: Some(TEXT_DIM),
        ..Default::default()
    }
}

pub fn error_bar(_: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(Color::from_rgb(0.240, 0.095, 0.090))),
        border: Border {
            color: alpha(DANGER, 0.72),
            width: 1.0,
            radius: border::radius(0.0),
        },
        text_color: Some(Color::from_rgb(1.0, 0.88, 0.88)),
        ..Default::default()
    }
}

pub fn tab_active(_: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(SURFACE_2)),
        border: Border {
            color: ACCENT,
            width: 1.0,
            radius: border::radius(RADIUS),
        },
        shadow: lift(0.18, 3.0, 14.0),
        text_color: Some(TEXT),
        ..Default::default()
    }
}

pub fn tab_inactive(_: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(SURFACE)),
        border: Border {
            color: alpha(BORDER, 0.62),
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
        ChipState::Active => (alpha(accent, 0.16), accent, TEXT),
        ChipState::Hover => (alpha(accent, 0.10), alpha(accent, 0.70), TEXT),
        ChipState::Idle => (SURFACE, alpha(BORDER, 0.62), TEXT_DIM),
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
        background: Some(Background::Color(alpha(ACCENT, 0.10))),
        border: Border {
            color: alpha(ACCENT, 0.70),
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
        button::Status::Hovered => TEXT,
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
    let (bg, fg, shadow) = match status {
        button::Status::Hovered => (ACCENT_STRONG, BG, lift(0.22, 3.0, 12.0)),
        button::Status::Pressed => (
            Color::from_rgb(0.120, 0.610, 0.540),
            BG,
            lift(0.12, 1.0, 6.0),
        ),
        button::Status::Disabled => (SURFACE_2, TEXT_MUTED, Shadow::default()),
        _ => (ACCENT, BG, lift(0.18, 2.0, 10.0)),
    };
    button::Style {
        background: Some(Background::Color(bg)),
        text_color: fg,
        border: Border {
            color: bg,
            width: 0.0,
            radius: border::radius(RADIUS),
        },
        shadow,
        ..Default::default()
    }
}

pub fn secondary_button(_: &Theme, status: button::Status) -> button::Style {
    let (bg, border_color, fg) = match status {
        button::Status::Hovered => (SURFACE_HOVER, BORDER_STRONG, TEXT),
        button::Status::Pressed => (SURFACE_2, ACCENT, TEXT),
        button::Status::Disabled => (SURFACE, BORDER, TEXT_MUTED),
        _ => (SURFACE_2, BORDER, TEXT),
    };
    button::Style {
        background: Some(Background::Color(bg)),
        text_color: fg,
        border: Border {
            color: border_color,
            width: 1.0,
            radius: border::radius(RADIUS),
        },
        ..Default::default()
    }
}

pub fn selected_button(_: &Theme, status: button::Status) -> button::Style {
    let (bg, border_color) = match status {
        button::Status::Hovered => (alpha(ACCENT, 0.18), ACCENT_STRONG),
        button::Status::Pressed => (alpha(ACCENT, 0.12), ACCENT),
        button::Status::Disabled => (SURFACE, BORDER),
        _ => (alpha(ACCENT, 0.14), alpha(ACCENT, 0.72)),
    };
    button::Style {
        background: Some(Background::Color(bg)),
        text_color: TEXT,
        border: Border {
            color: border_color,
            width: 1.0,
            radius: border::radius(RADIUS),
        },
        ..Default::default()
    }
}

pub fn ghost_button(_: &Theme, status: button::Status) -> button::Style {
    let (bg, fg) = match status {
        button::Status::Hovered => (Some(Background::Color(alpha(TEXT, 0.06))), TEXT),
        button::Status::Pressed => (Some(Background::Color(SURFACE_2)), TEXT),
        button::Status::Disabled => (None, TEXT_MUTED),
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
        button::Status::Hovered => (Color::from_rgb(0.520, 0.155, 0.145), Color::WHITE),
        button::Status::Pressed => (Color::from_rgb(0.420, 0.120, 0.115), Color::WHITE),
        button::Status::Disabled => (SURFACE, TEXT_DIM),
        _ => (
            Color::from_rgb(0.360, 0.115, 0.110),
            Color::from_rgb(1.0, 0.86, 0.84),
        ),
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
        shadow: lift(0.42, 18.0, 42.0),
        text_color: Some(TEXT),
        ..Default::default()
    }
}

pub fn modal_dimmer(_: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(Color {
            r: 0.0,
            g: 0.0,
            b: 0.0,
            a: 0.68,
        })),
        ..Default::default()
    }
}

pub fn terminal_frame(_: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(BG)),
        border: Border {
            color: alpha(BORDER_STRONG, 0.68),
            width: 1.0,
            radius: border::radius(RADIUS_SM),
        },
        shadow: lift(0.20, 6.0, 18.0),
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
        background: Background::Color(BG_RAISED),
        border: Border {
            color: border_color,
            width: 1.0,
            radius: border::radius(RADIUS_SM),
        },
        icon: TEXT_DIM,
        placeholder: TEXT_DIM,
        value: TEXT,
        selection: Color { a: 0.35, ..ACCENT },
    }
}

pub fn checkbox(_: &Theme, status: cb::Status) -> cb::Style {
    let is_checked = match status {
        cb::Status::Active { is_checked }
        | cb::Status::Hovered { is_checked }
        | cb::Status::Disabled { is_checked } => is_checked,
    };
    let hovered = matches!(status, cb::Status::Hovered { .. });
    let disabled = matches!(status, cb::Status::Disabled { .. });
    let border_color = if is_checked {
        ACCENT
    } else if hovered {
        BORDER_STRONG
    } else {
        BORDER
    };
    let bg = if is_checked {
        ACCENT
    } else if hovered {
        SURFACE_HOVER
    } else {
        BG_RAISED
    };
    cb::Style {
        background: Background::Color(if disabled { SURFACE } else { bg }),
        icon_color: BG,
        border: Border {
            color: border_color,
            width: 1.0,
            radius: border::radius(RADIUS_SM),
        },
        text_color: Some(if disabled { TEXT_MUTED } else { TEXT_DIM }),
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
