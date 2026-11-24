--[[ DaWestAccountLink
    Owns: redeeming website profile codes through the authenticated game API.
    SettingsController sends only a code. Identity always comes from the real Player.
    Reuses DaWestSite / DaWestGameKey (the same server-only key as faction linking).
    Success signals DaWestRankings to refresh this player's public rating.
]]
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerScriptService = game:GetService("ServerScriptService")

local folder = ReplicatedStorage:FindFirstChild("DaWestRankings") or Instance.new("Folder")
folder.Name = "DaWestRankings"
folder.Parent = ReplicatedStorage
local remote = folder:FindFirstChild("LinkAccount") or Instance.new("RemoteEvent")
remote.Name = "LinkAccount"
remote.Parent = folder

local pending, nextAttempt = {}, {}
local function reply(player, ok, message)
    if player.Parent == Players then
        remote:FireClient(player, { ok = ok, message = message })
    end
end

remote.OnServerEvent:Connect(function(player, rawCode)
    if pending[player] then
        return
    end
    local now = os.clock()
    if nextAttempt[player] and now < nextAttempt[player] then
        reply(player, false, "Please wait a few seconds before trying again.")
        return
    end
    nextAttempt[player] = now + 5
    if type(rawCode) ~= "string" or #rawCode > 32 then
        reply(player, false, "Enter the 10-character code from your website profile.")
        return
    end
    local code = rawCode:upper():gsub("[%s%-]", "")
    if #code ~= 10 or not code:match("^[A-HJ-NP-Z2-9]+$") then
        reply(player, false, "Enter the 10-character code from your website profile.")
        return
    end
    if player.UserId <= 0 then
        reply(player, false, "Use a signed-in Roblox account to link your profile.")
        return
    end
    pending[player] = true
    local called, sent, status, data = pcall(function()
        local site = require(ServerScriptService:WaitForChild("DaWestSite", 5))
        return site.Post("game/players/link/", {
            code = code,
            roblox_user_id = player.UserId,
            roblox_username = player.Name,
            roblox_display_name = player.DisplayName,
        })
    end)
    pending[player] = nil
    if not called then
        warn("[DaWestAccountLink] Server bridge failed:", sent)
        reply(player, false, "Couldn't reach DaWest Rankings. Please try again shortly.")
    elseif not sent then
        local message = if data and type(data.detail) == "string" then data.detail
            elseif status == 404 then "Linking is not available yet. Please try again after the site update."
            else "Couldn't link your account. Check your code or try again shortly."
        reply(player, false, message)
    elseif not (data and data.ok == true and type(data.username) == "string") then
        reply(player, false, "The site returned an unexpected answer. Check your website profile.")
    else
        if player.Parent == Players then
            player:SetAttribute("DaWestLinkConfirmedAt", workspace:GetServerTimeNow())
        end
        reply(player, true, "Linked to " .. data.username .. ". Your rating is updating.")
    end
end)

Players.PlayerRemoving:Connect(function(player)
    pending[player] = nil
    nextAttempt[player] = nil
end)
