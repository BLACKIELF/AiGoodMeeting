use tauri::{menu::{Menu, PredefinedMenuItem as Item, Submenu}, AppHandle, Runtime};

/// Retain native editing shortcuts while presenting the app menu in Chinese.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let application = Submenu::with_items(app, "AiGoodMeeting", true, &[
        &Item::about(app, Some("关于 AiGoodMeeting"), None)?,
        &Item::separator(app)?,
        &Item::services(app, Some("服务"))?,
        &Item::separator(app)?,
        &Item::hide(app, Some("隐藏 AiGoodMeeting"))?,
        &Item::hide_others(app, Some("隐藏其他应用"))?,
        &Item::show_all(app, Some("显示全部"))?,
        &Item::separator(app)?,
        &Item::quit(app, Some("退出 AiGoodMeeting"))?,
    ])?;
    let edit = Submenu::with_items(app, "编辑", true, &[
        &Item::undo(app, Some("撤销"))?,
        &Item::redo(app, Some("重做"))?,
        &Item::separator(app)?,
        &Item::cut(app, Some("剪切"))?,
        &Item::copy(app, Some("复制"))?,
        &Item::paste(app, Some("粘贴"))?,
        &Item::select_all(app, Some("全选"))?,
    ])?;
    let window = Submenu::with_items(app, "窗口", true, &[
        &Item::minimize(app, Some("最小化"))?,
        &Item::maximize(app, Some("缩放"))?,
        &Item::fullscreen(app, Some("切换全屏"))?,
        &Item::close_window(app, Some("关闭窗口"))?,
        &Item::separator(app)?,
        &Item::bring_all_to_front(app, Some("全部前置"))?,
    ])?;
    Menu::with_items(app, &[&application, &edit, &window])
}
