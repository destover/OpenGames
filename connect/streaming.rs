use futures_util::StreamExt;
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use tokio::sync::mpsc::Sender;
use tokio_tungstenite::tungstenite::Message;

const RESULT_LIMIT: usize = 65_536;

fn usage(data: &Value) -> Option<Value> {
    Some(json!({
        "promptTokens": data["usage"]["prompt_tokens"].as_u64()?,
        "completionTokens": data["usage"]["completion_tokens"].as_u64()?
    }))
}

pub async fn read_result(
    response: reqwest::Response,
    sender: &Sender<Message>,
    identity: &Value,
) -> Result<(Value, Option<Value>), &'static str> {
    let streaming = response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.contains("text/event-stream"));
    if !streaming {
        let bytes = response.bytes().await.map_err(|_| "model")?;
        if bytes.len() > RESULT_LIMIT {
            return Err("model");
        }
        let data: Value = serde_json::from_slice(&bytes).map_err(|_| "model")?;
        let content = data["choices"][0]["message"]["content"]
            .as_str()
            .ok_or("model")?;
        return Ok((
            serde_json::from_str(content).map_err(|_| "model")?,
            usage(&data),
        ));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = Vec::new();
    let mut content = String::new();
    let mut sent = 0;
    let mut last_update = Instant::now();
    let mut finished = false;
    let mut done = false;
    let mut tokens = None;
    while let Some(chunk) = stream.next().await {
        buffer.extend_from_slice(&chunk.map_err(|_| "model")?);
        if buffer.len() > RESULT_LIMIT * 8 {
            return Err("model");
        }
        let mut consumed = 0;
        for line in buffer.split_inclusive(|byte| *byte == b'\n') {
            if !line.ends_with(b"\n") {
                break;
            }
            consumed += line.len();
            let line = std::str::from_utf8(line).map_err(|_| "model")?.trim();
            let Some(payload) = line.strip_prefix("data:") else {
                continue;
            };
            if payload.trim() == "[DONE]" {
                done = true;
                finished = true;
                break;
            }
            let data: Value = serde_json::from_str(payload).map_err(|_| "model")?;
            let choice = &data["choices"][0];
            if !data["error"].is_null() || choice["finish_reason"] == "error" {
                return Err("model");
            }
            finished |= choice["finish_reason"].is_string();
            tokens = usage(&data).or(tokens);
            if let Some(delta) = choice["delta"]["content"].as_str() {
                content.push_str(delta);
            }
            if content.len() > RESULT_LIMIT {
                return Err("model");
            }
            if sent < content.len()
                && (sent == 0 || last_update.elapsed() >= Duration::from_millis(125))
            {
                send_delta(sender, identity, &content[sent..]).await?;
                sent = content.len();
                last_update = Instant::now();
            }
        }
        buffer.drain(..consumed);
        if done {
            break;
        }
    }
    if !finished {
        return Err("model");
    }
    if sent < content.len() {
        send_delta(sender, identity, &content[sent..]).await?;
    }
    Ok((serde_json::from_str(&content).map_err(|_| "model")?, tokens))
}

async fn send_delta(
    sender: &Sender<Message>,
    identity: &Value,
    content: &str,
) -> Result<(), &'static str> {
    let mut event = identity.clone();
    event["type"] = json!("delta");
    event["content"] = json!(content);
    sender
        .send(Message::Text(event.to_string().into()))
        .await
        .map_err(|_| "cancelled")
}
