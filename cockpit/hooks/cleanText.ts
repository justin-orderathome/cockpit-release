/**
 * 同事提供的文字（聊天版成員、暱稱、檔名）顯示前的清理：拿掉控制字元（含換行與 ESC），
 * 以及文字方向控制字元（可以把 `gpj.exe` 排成看起來像 `exe.jpg`）與行、段分隔字元。
 */
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u061c\u200e-\u200f\u2028-\u202e\u2066-\u2069]/g

export const cleanText = (text: string): string => text.replace(UNSAFE, '')
