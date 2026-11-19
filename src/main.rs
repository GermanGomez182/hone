mod app;

use std::path::PathBuf;
use std::process::ExitCode;

use eframe::egui::ViewportBuilder;

use polish::clipboard::paste_text;
use polish::config::claude_config;
use polish::process::SystemRunner;
use polish::rewriter::ClaudeCli;
use polish::theme::{Palette, load_palette};

/// Wayland app id; the Hyprland window rule matches on it.
const APP_ID: &str = "polish";
const WINDOW_SIZE: [f32; 2] = [760.0, 540.0];
const THEME_COLORS: &str = ".local/state/omarchy/current/theme/colors.toml";
/// Dependencies (zbus, wgpu) are chatty at info; keep their warnings only.
const LOG_FILTER: &str = "warn,polish=info";

fn main() -> ExitCode {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or(LOG_FILTER))
        .format_timestamp_millis()
        .init();

    let config = match claude_config(|var| std::env::var(var).ok()) {
        Ok(config) => config,
        Err(error) => {
            log::error!("invalid configuration: {error}");
            return ExitCode::FAILURE;
        }
    };
    log::info!(
        "starting model={} timeout_s={}",
        config.model,
        config.timeout.as_secs()
    );

    let initial_input = initial_input();
    let palette = theme_palette();
    let rewriter = ClaudeCli::new(SystemRunner, config);
    let options = eframe::NativeOptions {
        viewport: ViewportBuilder::default()
            .with_app_id(APP_ID)
            .with_title("Polish")
            .with_inner_size(WINDOW_SIZE),
        ..Default::default()
    };
    let run = eframe::run_native(
        APP_ID,
        options,
        Box::new(move |cc| {
            Ok(Box::new(app::PolishApp::new(
                cc,
                initial_input,
                rewriter,
                palette,
            )))
        }),
    );
    if let Err(error) = run {
        log::error!("window failed: {error}");
        return ExitCode::FAILURE;
    }
    log::info!("window closed; exiting");
    ExitCode::SUCCESS
}

fn initial_input() -> String {
    match paste_text() {
        Ok(text) => text.unwrap_or_default(),
        Err(error) => {
            log::warn!("starting with an empty input: {error}");
            String::new()
        }
    }
}

fn theme_palette() -> Option<Palette> {
    let Some(home) = std::env::var_os("HOME") else {
        log::warn!("HOME is not set; using the default look");
        return None;
    };
    let path = PathBuf::from(home).join(THEME_COLORS);
    match load_palette(&path) {
        Ok(palette) => Some(palette),
        Err(error) => {
            log::warn!("using the default look: {error}");
            None
        }
    }
}
