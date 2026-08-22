// The menu bar, built from the page's MenuModel (src/models/appMenu.ts) with muda, and a
// default one for before the page installs its own - without an Edit menu, Cmd-C/V do not
// reach the webview on macOS at all.

use std::collections::HashMap;

use muda::{
    accelerator::Accelerator, AboutMetadata, CheckMenuItem, IsMenuItem, Menu, MenuItem, MenuItemKind,
    PredefinedMenuItem, Submenu,
};
use serde::Deserialize;
use tao::window::Window;

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Entry {
    Item {
        id: String,
        label: String,
        #[serde(default)]
        accelerator: Option<String>,
        #[serde(default = "yes")]
        native: bool,
        #[serde(default = "yes")]
        enabled: bool,
        #[serde(default)]
        checked: Option<bool>,
    },
    Separator,
    Predefined {
        item: String,
        #[serde(default)]
        label: Option<String>,
    },
    About {
        label: String,
        info: AboutInfo,
    },
}

fn yes() -> bool {
    true
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AboutInfo {
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub comments: String,
    #[serde(default)]
    pub website: String,
    #[serde(default)]
    pub website_label: String,
    #[serde(default)]
    pub credits: String,
    #[serde(default)]
    pub authors: Vec<String>,
}

#[derive(Deserialize)]
pub struct Model {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub role: Option<String>,
    pub items: Vec<Entry>,
}

#[derive(Deserialize)]
pub struct Patch {
    pub id: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub checked: Option<bool>,
}

#[derive(Default)]
pub struct MenuState {
    root: Option<Menu>,
    items: HashMap<String, MenuItemKind>,
}

pub fn install(state: &mut MenuState, window: &Window, models: Vec<Model>) -> Result<(), String> {
    let menu = Menu::new();
    let mut items = HashMap::new();
    for model in models {
        let submenu = Submenu::with_id(&model.id, &model.label, true);
        for entry in model.items {
            match entry {
                Entry::Separator => append(&submenu, &PredefinedMenuItem::separator())?,
                Entry::Predefined { item, label } => append(&submenu, &predefined(&item, label.as_deref())?)?,
                Entry::About { label, info } => {
                    let meta = AboutMetadata {
                        name: Some(info.name),
                        version: Some(info.version),
                        comments: Some(info.comments),
                        website: Some(info.website),
                        website_label: Some(info.website_label),
                        credits: Some(info.credits),
                        authors: Some(info.authors),
                        ..Default::default()
                    };
                    append(&submenu, &PredefinedMenuItem::about(Some(&label), Some(meta)))?
                }
                Entry::Item { id, label, accelerator, native, enabled, checked } => {
                    let accel = if native {
                        accelerator.as_deref().and_then(|a| a.parse::<Accelerator>().ok())
                    } else {
                        None
                    };
                    match checked {
                        Some(checked) => {
                            let item = CheckMenuItem::with_id(&id, &label, enabled, checked, accel);
                            append(&submenu, &item)?;
                            items.insert(id, MenuItemKind::Check(item));
                        }
                        None => {
                            let item = MenuItem::with_id(&id, &label, enabled, accel);
                            append(&submenu, &item)?;
                            items.insert(id, MenuItemKind::MenuItem(item));
                        }
                    }
                }
            }
        }
        #[cfg(target_os = "macos")]
        match model.role.as_deref() {
            Some("window") => submenu.set_as_windows_menu_for_nsapp(),
            Some("help") => submenu.set_as_help_menu_for_nsapp(),
            _ => {}
        }
        menu.append(&submenu).map_err(|e| e.to_string())?;
    }
    show(state, window, menu)?;
    state.items = items;
    Ok(())
}

pub fn update(state: &mut MenuState, patch: Patch) {
    match state.items.get(&patch.id) {
        Some(MenuItemKind::MenuItem(item)) => {
            if let Some(label) = patch.label {
                item.set_text(label);
            }
            if let Some(enabled) = patch.enabled {
                item.set_enabled(enabled);
            }
        }
        Some(MenuItemKind::Check(item)) => {
            if let Some(label) = patch.label {
                item.set_text(label);
            }
            if let Some(enabled) = patch.enabled {
                item.set_enabled(enabled);
            }
            if let Some(checked) = patch.checked {
                item.set_checked(checked);
            }
        }
        _ => {}
    }
}

/// App + Edit, enough to quit and to paste, until the page's own arrives.
pub fn install_default(state: &mut MenuState, window: &Window) -> Result<(), String> {
    let menu = Menu::new();
    let app = Submenu::new("md-boss", true);
    append(&app, &PredefinedMenuItem::about(None, None))?;
    append(&app, &PredefinedMenuItem::separator())?;
    append(&app, &PredefinedMenuItem::quit(None))?;
    let edit = Submenu::new("Edit", true);
    append(&edit, &PredefinedMenuItem::undo(None))?;
    append(&edit, &PredefinedMenuItem::redo(None))?;
    append(&edit, &PredefinedMenuItem::separator())?;
    append(&edit, &PredefinedMenuItem::cut(None))?;
    append(&edit, &PredefinedMenuItem::copy(None))?;
    append(&edit, &PredefinedMenuItem::paste(None))?;
    append(&edit, &PredefinedMenuItem::select_all(None))?;
    menu.append(&app).map_err(|e| e.to_string())?;
    menu.append(&edit).map_err(|e| e.to_string())?;
    show(state, window, menu)
}

fn append(submenu: &Submenu, item: &dyn IsMenuItem) -> Result<(), String> {
    submenu.append(item).map_err(|e| e.to_string())
}

#[allow(unused_variables)]
fn show(state: &mut MenuState, window: &Window, menu: Menu) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if let Some(old) = state.root.take() {
            old.remove_for_nsapp();
        }
        menu.init_for_nsapp();
    }
    #[cfg(target_os = "windows")]
    {
        use tao::platform::windows::WindowExtWindows;
        let hwnd = window.hwnd() as isize;
        if let Some(old) = state.root.take() {
            unsafe { old.remove_for_hwnd(hwnd) }.map_err(|e| e.to_string())?;
        }
        unsafe { menu.init_for_hwnd(hwnd) }.map_err(|e| e.to_string())?;
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        use tao::platform::unix::WindowExtUnix;
        if let Some(old) = state.root.take() {
            old.remove_for_gtk_window(window.gtk_window(), window.default_vbox())
                .map_err(|e| e.to_string())?;
        }
        menu.init_for_gtk_window(window.gtk_window(), window.default_vbox())
            .map_err(|e| e.to_string())?;
    }
    state.root = Some(menu);
    Ok(())
}

fn predefined(kind: &str, text: Option<&str>) -> Result<PredefinedMenuItem, String> {
    Ok(match kind {
        "Undo" => PredefinedMenuItem::undo(text),
        "Redo" => PredefinedMenuItem::redo(text),
        "Cut" => PredefinedMenuItem::cut(text),
        "Copy" => PredefinedMenuItem::copy(text),
        "Paste" => PredefinedMenuItem::paste(text),
        "SelectAll" => PredefinedMenuItem::select_all(text),
        "Minimize" => PredefinedMenuItem::minimize(text),
        "Maximize" => PredefinedMenuItem::maximize(text),
        "Fullscreen" => PredefinedMenuItem::fullscreen(text),
        "CloseWindow" => PredefinedMenuItem::close_window(text),
        "BringAllToFront" => PredefinedMenuItem::bring_all_to_front(text),
        "Hide" => PredefinedMenuItem::hide(text),
        "HideOthers" => PredefinedMenuItem::hide_others(text),
        "ShowAll" => PredefinedMenuItem::show_all(text),
        "Services" => PredefinedMenuItem::services(text),
        "Quit" => PredefinedMenuItem::quit(text),
        "Separator" => PredefinedMenuItem::separator(),
        other => return Err(format!("unknown predefined menu item: {other}")),
    })
}
