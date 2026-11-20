// Run against an isolated migrated SQLite API on :8001 and the frontend on :5173.
import { chromium, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
if(!process.env.SQLITE_PATH)throw new Error("Set SQLITE_PATH to the isolated API test database.");
const stamp=Date.now().toString();
const password="Frontier!"+randomBytes(14).toString("hex");
const dev="qa_dev_"+stamp,captain="qa_capt_"+stamp,mate="qa_mate_"+stamp;
const python=resolve(".venv",process.platform==="win32"?"Scripts/python.exe":"bin/python");
const created=spawnSync(python,["manage.py","create_dev","--username",dev,"--password-stdin"],{cwd:resolve("backend-django"),env:process.env,input:password+"\n",encoding:"utf8"});
if(created.status!==0)throw new Error("Developer fixture failed: "+created.stderr);
const executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const browser=await chromium.launch(executablePath?{executablePath}:{});
async function newPage(){const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();await page.addInitScript(()=>sessionStorage.setItem("dawest:intro-seen:v1","1"));await page.route("**/api/v1/**",route=>{const url=new URL(route.request().url());url.port="8001";return route.continue({url:url.toString()});});return {page,context};}
async function signup(page,username,name){await page.goto("http://127.0.0.1:5173/signup");await page.getByLabel("Username",{exact:true}).fill(username);await page.getByLabel("Display name",{exact:true}).fill(name);await page.getByLabel("Password",{exact:true}).fill(password);await page.getByLabel("Confirm password",{exact:true}).fill(password);const sent=page.waitForResponse(r=>r.url().endsWith("/auth/signup/")&&r.request().method()==="POST");await page.getByRole("button",{name:"Create player account",exact:true}).click();const response=await sent;if(response.status()!==201)throw new Error("Signup failed: "+response.status());await page.waitForURL("http://127.0.0.1:5173/");await expect(page.locator("tbody")).toContainText(name);}
try{
 const c=await newPage(),m=await newPage(),d=await newPage();
 await signup(c.page,captain,"QA Captain");await signup(m.page,mate,"QA Teammate");
 await c.page.reload();await expect(c.page.locator(".account-username")).toContainText(captain);
 await c.page.goto("http://127.0.0.1:5173/register");await expect(c.page.getByLabel("Captain username",{exact:true})).toHaveValue(captain);await expect(c.page.getByLabel("Contact email",{exact:true})).toHaveCount(0);
 const teamName="QA Registered Crew "+stamp,tag="Q"+stamp.slice(-4);
 await c.page.getByLabel("Team name",{exact:true}).fill(teamName);await c.page.getByLabel("Team tag",{exact:true}).fill(tag);await c.page.getByLabel("Player 2 username",{exact:true}).fill(mate);await c.page.getByRole("button",{name:"Submit team registration"}).click();await expect(c.page.getByRole("heading",{name:"REGISTRATION RECEIVED."})).toBeVisible();
 expect((await c.context.request.get("http://127.0.0.1:8001/api/v1/dev/dashboard/")).status()).toBe(403);
 await d.page.goto("http://127.0.0.1:5173/dev/login");await d.page.getByLabel("Username",{exact:true}).fill(dev);await d.page.getByLabel("Password",{exact:true}).fill(password);await d.page.getByRole("button",{name:"Sign in to developer console"}).click();await expect(d.page.getByRole("heading",{name:"CONTROL THE FRONTIER."})).toBeVisible();
 const application=d.page.locator(".dev-application").filter({hasText:teamName});await expect(application).toBeVisible();await application.getByLabel("Public review note").fill("Verified registered roster.");await application.getByRole("button",{name:"Approve",exact:true}).click();await expect(d.page.getByRole("status")).toContainText("approved");
 let teams=await(await c.context.request.get("http://127.0.0.1:8001/api/v1/teams/rankings/")).json();expect(teams.teams.find(t=>t.display_name===teamName)?.roster.length).toBe(2);
 await d.page.screenshot({path:"artifacts/developer-authenticated.png",fullPage:true});
 await d.page.getByRole("button",{name:"Players",exact:true}).click();const row=d.page.locator(".dev-table tbody tr").filter({hasText:captain});await row.getByRole("button",{name:"Remove",exact:true}).click();await expect(row.getByRole("button",{name:"Restore",exact:true})).toBeVisible();
 expect((await(await c.context.request.get("http://127.0.0.1:8001/api/v1/auth/session/")).json()).authenticated).toBe(false);
 await row.getByRole("button",{name:"Restore",exact:true}).click();await expect(row.getByRole("button",{name:"Remove",exact:true})).toBeVisible();expect((await(await c.context.request.get("http://127.0.0.1:8001/api/v1/auth/session/")).json()).authenticated).toBe(false);
 await d.page.getByRole("button",{name:"Teams",exact:true}).click();const teamrow=d.page.locator(".dev-table tbody tr").filter({hasText:teamName});await teamrow.getByRole("button",{name:"Remove",exact:true}).click();await expect(teamrow.getByRole("button",{name:"Restore",exact:true})).toBeVisible();teams=await(await m.context.request.get("http://127.0.0.1:8001/api/v1/teams/rankings/")).json();expect(teams.teams.some(t=>t.display_name===teamName)).toBe(false);await teamrow.getByRole("button",{name:"Restore",exact:true}).click();await expect(teamrow.getByRole("button",{name:"Remove",exact:true})).toBeVisible();
 const extraA="qa_added1_"+stamp,extraB="qa_added2_"+stamp;
 await d.page.getByRole("button",{name:"Players",exact:true}).click();
 for(const [username,display] of [[extraA,"QA Added One"],[extraB,"QA Added Two"]]){
   await d.page.getByRole("button",{name:"Add player",exact:true}).click();const dialog=d.page.getByRole("dialog",{name:"ADD PLAYER ACCOUNT"});await dialog.getByLabel("Display name",{exact:true}).fill(display);await dialog.getByLabel("Username",{exact:true}).fill(username);await dialog.getByLabel("Initial password",{exact:true}).fill(password);await dialog.getByLabel("Confirm password",{exact:true}).fill(password);await dialog.getByRole("button",{name:"Create player account",exact:true}).click();await expect(dialog).toHaveCount(0);await expect(d.page.locator(".dev-table tbody")).toContainText(username);
 }
 await d.page.getByRole("button",{name:"Teams",exact:true}).click();await d.page.getByRole("button",{name:"Add team",exact:true}).click();const teamDialog=d.page.getByRole("dialog",{name:"ADD TEAM"});const devTeamName="QA Developer Crew "+stamp;await teamDialog.getByLabel("Team name",{exact:true}).fill(devTeamName);await teamDialog.getByLabel("Team tag",{exact:true}).fill("D"+stamp.slice(-4));await teamDialog.getByLabel("Captain",{exact:true}).selectOption(extraA);await teamDialog.locator(".dev-player-picker label").filter({hasText:extraB}).locator("input").check();await teamDialog.getByRole("button",{name:"Create team",exact:true}).click();await expect(teamDialog).toHaveCount(0);await expect(d.page.locator(".dev-table tbody")).toContainText(devTeamName);
 await d.page.setViewportSize({width:390,height:844});expect(await d.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await d.page.screenshot({path:"artifacts/developer-mobile.png",fullPage:true});
 console.log("PASS: real signup, persistent login, registered roster without email, developer approval, role denial, developer player/team creation, player/team removal/restoration, and session revocation. Isolated database only.");
}finally{await browser.close();}
