use std::sync::Arc;
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;
use std::time::Instant;

use eframe::egui::{
    self, Color32, FontId, Frame, Key, Modifiers, RichText, ScrollArea, TextEdit, TextStyle,
    ViewportCommand,
};

use hone::clipboard::copy_text;
use hone::mode::Mode;
use hone::process::SystemRunner;
use hone::rewriter::ClaudeCli;
use hone::state::{AppState, Effect, Status};
use hone::theme::{Palette, Rgb};

type RewriteResult = Result<String, String>;

const MODE_KEYS: [(Key, Mode); 2] = [(Key::Num1, Mode::Grammar), (Key::Num2, Mode::Polish)];
const BODY_SIZE: f32 = 15.0;
const SMALL_SIZE: f32 = 12.0;
const MARGIN: i8 = 16;
const GAP: f32 = 8.0;
const SECTION_LABEL_HEIGHT: f32 = 22.0;
const HINTS: &str = "Ctrl+Enter  rewrite / copy & close     Ctrl+1/2  mode     Esc  close";

pub struct HoneApp {
    state: AppState,
    rewriter: Arc<ClaudeCli<SystemRunner>>,
    results_tx: Sender<RewriteResult>,
    results_rx: Receiver<RewriteResult>,
    notice: Option<String>,
    focus_input: bool,
}

impl HoneApp {
    pub fn new(
        cc: &eframe::CreationContext<'_>,
        initial_input: String,
        rewriter: ClaudeCli<SystemRunner>,
        palette: Option<Palette>,
    ) -> Self {
        apply_style(&cc.egui_ctx, palette.as_ref());
        let (results_tx, results_rx) = mpsc::channel();
        Self {
            state: AppState::new(initial_input),
            rewriter: Arc::new(rewriter),
            results_tx,
            results_rx,
            notice: None,
            focus_input: true,
        }
    }

    fn receive_results(&mut self) {
        while let Ok(result) = self.results_rx.try_recv() {
            self.state.rewrite_finished(result);
        }
    }

    fn handle_shortcuts(&mut self, ctx: &egui::Context) {
        if ctx.input_mut(|i| i.consume_key(Modifiers::NONE, Key::Escape)) {
            log::info!("closed without copying");
            ctx.send_viewport_cmd(ViewportCommand::Close);
            return;
        }
        for (key, mode) in MODE_KEYS {
            if ctx.input_mut(|i| i.consume_key(Modifiers::COMMAND, key)) {
                self.state.set_mode(mode);
            }
        }
        if ctx.input_mut(|i| i.consume_key(Modifiers::COMMAND, Key::Enter)) {
            self.submit(ctx);
        }
    }

    fn submit(&mut self, ctx: &egui::Context) {
        self.notice = None;
        match self.state.submit() {
            Effect::Nothing => {}
            Effect::StartRewrite { mode, text } => self.start_rewrite(ctx, mode, text),
            Effect::CopyAndClose(text) => self.copy_and_close(ctx, &text),
        }
    }

    fn start_rewrite(&self, ctx: &egui::Context, mode: Mode, text: String) {
        log::info!(
            "rewrite started mode={} chars={}",
            mode.label(),
            text.chars().count()
        );
        let rewriter = Arc::clone(&self.rewriter);
        let results = self.results_tx.clone();
        let ctx = ctx.clone();
        thread::spawn(move || {
            let started = Instant::now();
            let result = rewriter.rewrite(mode, &text).map_err(|error| {
                log::error!("rewrite failed mode={}: {error}", mode.label());
                error.to_string()
            });
            if result.is_ok() {
                log::info!(
                    "rewrite finished mode={} elapsed_ms={}",
                    mode.label(),
                    started.elapsed().as_millis()
                );
            }
            if results.send(result).is_err() {
                log::debug!("window closed before the rewrite finished");
            }
            ctx.request_repaint();
        });
    }

    fn copy_and_close(&mut self, ctx: &egui::Context, text: &str) {
        if let Err(error) = copy_text(text) {
            log::error!("copy failed: {error}");
            self.notice = Some(error.to_string());
            return;
        }
        log::info!("copied result chars={}; closing", text.chars().count());
        ctx.send_viewport_cmd(ViewportCommand::Close);
    }

    fn header(&mut self, ui: &mut egui::Ui) {
        ui.horizontal(|ui| {
            ui.label(RichText::new("Hone").strong().size(BODY_SIZE + 3.0));
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                for (index, mode) in Mode::ALL.iter().enumerate().rev() {
                    let label = format!("{}  Ctrl+{}", mode.label(), index + 1);
                    let selected = self.state.mode() == *mode;
                    if ui.selectable_label(selected, label).clicked() {
                        self.state.set_mode(*mode);
                    }
                }
            });
        });
    }

    fn input(&mut self, ui: &mut egui::Ui, height: f32) {
        section_label(ui, "Original");
        let running = self.state.status() == &Status::Running;
        let response = ScrollArea::vertical()
            .id_salt("input")
            .max_height(height)
            .show(ui, |ui| {
                ui.add_sized(
                    [ui.available_width(), height],
                    TextEdit::multiline(&mut self.state.input)
                        .hint_text("Paste or type the text to check")
                        .interactive(!running),
                )
            })
            .inner;
        if self.focus_input {
            response.request_focus();
            self.focus_input = false;
        }
        if response.changed() {
            self.state.input_edited();
        }
    }

    fn result(&mut self, ui: &mut egui::Ui, height: f32) {
        section_label(ui, "Result");
        let weak = ui.visuals().weak_text_color();
        let error = ui.visuals().error_fg_color;
        match self.state.status().clone() {
            Status::Idle => {
                ui.label(RichText::new("Press Ctrl+Enter to rewrite").color(weak));
            }
            Status::Running => {
                ui.horizontal(|ui| {
                    ui.spinner();
                    ui.label(RichText::new("Rewriting...").color(weak));
                });
            }
            Status::Failed(message) => {
                ui.label(RichText::new(message).color(error));
            }
            Status::Done(_) => self.result_editor(ui, height),
        }
        if let Some(notice) = &self.notice {
            ui.label(RichText::new(notice).color(error));
        }
    }

    fn result_editor(&mut self, ui: &mut egui::Ui, height: f32) {
        let Some(result) = self.state.result_mut() else {
            return;
        };
        ScrollArea::vertical()
            .id_salt("result")
            .max_height(height)
            .show(ui, |ui| {
                ui.add_sized([ui.available_width(), height], TextEdit::multiline(result));
            });
    }
}

impl eframe::App for HoneApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.receive_results();
        self.handle_shortcuts(ctx);

        egui::TopBottomPanel::bottom("hints")
            .frame(
                Frame::new()
                    .fill(ctx.style().visuals.panel_fill)
                    .inner_margin(MARGIN),
            )
            .show(ctx, |ui| {
                ui.label(
                    RichText::new(HINTS)
                        .size(SMALL_SIZE)
                        .color(ui.visuals().weak_text_color()),
                );
            });

        egui::CentralPanel::default()
            .frame(
                Frame::new()
                    .fill(ctx.style().visuals.panel_fill)
                    .inner_margin(MARGIN),
            )
            .show(ctx, |ui| {
                self.header(ui);
                ui.add_space(GAP);
                let pane_height = (ui.available_height() - 2.0 * SECTION_LABEL_HEIGHT - GAP) / 2.0;
                self.input(ui, pane_height);
                ui.add_space(GAP);
                self.result(ui, pane_height);
            });
    }
}

fn section_label(ui: &mut egui::Ui, text: &str) {
    let color = ui.visuals().weak_text_color();
    ui.label(RichText::new(text).size(SMALL_SIZE).color(color));
}

fn apply_style(ctx: &egui::Context, palette: Option<&Palette>) {
    ctx.style_mut(|style| {
        style
            .text_styles
            .insert(TextStyle::Body, FontId::proportional(BODY_SIZE));
        style
            .text_styles
            .insert(TextStyle::Button, FontId::proportional(BODY_SIZE - 1.0));
        style
            .text_styles
            .insert(TextStyle::Monospace, FontId::monospace(BODY_SIZE - 1.0));
    });
    let Some(palette) = palette else {
        return;
    };
    ctx.set_visuals(themed_visuals(palette));
}

fn themed_visuals(palette: &Palette) -> egui::Visuals {
    let mut visuals = if palette.dark {
        egui::Visuals::dark()
    } else {
        egui::Visuals::light()
    };
    let [background, surface, foreground] =
        [palette.background, palette.surface, palette.foreground].map(color);
    let accent = color(palette.accent);
    visuals.panel_fill = background;
    visuals.window_fill = background;
    visuals.extreme_bg_color = surface;
    visuals.faint_bg_color = surface;
    visuals.override_text_color = Some(foreground);
    visuals.weak_text_color = Some(color(palette.muted));
    visuals.error_fg_color = color(palette.error);
    visuals.hyperlink_color = accent;
    visuals.selection.bg_fill = color(palette.selection);
    visuals.selection.stroke.color = accent;
    visuals.text_cursor.stroke.color = accent;
    visuals.widgets.inactive.weak_bg_fill = surface;
    visuals.widgets.hovered.weak_bg_fill = color(palette.selection);
    visuals.widgets.active.weak_bg_fill = color(palette.selection);
    visuals.widgets.hovered.bg_stroke.color = accent;
    visuals
}

fn color([r, g, b]: Rgb) -> Color32 {
    Color32::from_rgb(r, g, b)
}
