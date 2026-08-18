import os
from flask import Flask, render_template, request, jsonify, redirect, url_for, session, make_response, abort, g
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()


def get_required_env(var_name: str) -> str:
    value = os.environ.get(var_name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {var_name}")
    return value


app = Flask(__name__)
app.config.update(
    SECRET_KEY=get_required_env("FLASK_SECRET_KEY"),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=not app.debug,
)

supabase: Client = create_client(
    get_required_env("SUPABASE_URL"),
    get_required_env("SUPABASE_KEY"),
)


def get_authenticated_supabase() -> Client:
    access_token = session.get("access_token")
    refresh_token = session.get("refresh_token")

    if access_token and refresh_token:
        try:
            supabase.auth.set_session(access_token, refresh_token)
            session_data = supabase.auth.get_session()
            if session_data is not None:
                session["access_token"] = session_data.access_token
                session["refresh_token"] = session_data.refresh_token
        except Exception as exc:  # pragma: no cover - only used for session recovery
            message = str(exc).lower()
            if "invalid refresh token" in message or "already used" in message:
                session.clear()
                return supabase
            raise

    return supabase


@app.route("/")
def Home():
    if "user_id" in session:
        return redirect(url_for("Projects"))
    return render_template("auth/home.html")


# Auth
@app.route("/Login", methods=("GET", "POST"))
def Login():
    if "user_id" not in session:
        response = supabase.auth.sign_in_with_oauth(
            {
                "provider": "discord",
                "options": {
                    "redirect_to": f"{request.host_url}callback"
                }
            }
        )
        return redirect(response.url, code=302)
    return redirect(url_for("Home"))


@app.route("/callback")
def callback():
    code = request.args.get("code")
    if not code:
        return redirect(url_for("Home"))

    response = supabase.auth.exchange_code_for_session({"auth_code": code}) # type: ignore

    session["user_id"] = response.user.id # type: ignore
    session["access_token"] = response.session.access_token # type: ignore
    session["refresh_token"] = response.session.refresh_token # type: ignore

    permissions = (
        supabase.table("PermissionsTable")
        .select("permission")
        .eq("user_id", response.user.id) # type: ignore
        .execute()
    )
    session["permissions"] = [p["permission"] for p in permissions.data] # type: ignore

    return redirect(url_for("Projects"))


@app.before_request
def restore_session():
    # Ensure g.user is set for templates. If there is no logged-in user, clear g.user.
    if "user_id" not in session:
        g.user = None
        return

    access_token = session.get("access_token")
    refresh_token = session.get("refresh_token")
    if not access_token or not refresh_token:
        session.clear()
        g.user = None
        return

    try:
        # Re-establish supabase client session if possible
        supabase_client = get_authenticated_supabase()
    except Exception as exc:
        message = str(exc).lower()
        if "invalid refresh token" in message or "already used" in message:
            session.clear()
            g.user = None
            return redirect(url_for("Home"))
        raise

    # Attempt to load user info from Supabase auth to display username/avatar in the header
    try:
        user_resp = supabase_client.auth.get_user()

        # Normalize possible response shapes
        user_obj = None
        if isinstance(user_resp, dict):
            user_obj = user_resp.get('data') or user_resp.get('user') or user_resp
        else:
            user_obj = getattr(user_resp, 'user', None) or getattr(user_resp, 'data', None) or user_resp

        username = None
        avatar = None

        if isinstance(user_obj, dict):
            user_meta = user_obj.get('user_metadata') or user_obj.get('raw_user_meta_data') or {}

            # Sometimes Discord global_name is nested under custom_claims
            custom_claims = user_meta.get('custom_claims') if isinstance(user_meta, dict) else None
            global_name_from_claims = None
            if isinstance(custom_claims, dict):
                global_name_from_claims = custom_claims.get('global_name')

            # Prefer 'global_name' from custom_claims, then direct fields, then fallbacks
            username = (
                global_name_from_claims
                or user_meta.get('global_name')
                or user_meta.get('username')
                or user_meta.get('name')
                or user_meta.get('preferred_username')
                or user_obj.get('email')
                or session.get('user_id')
            )

            avatar = (
                user_meta.get('avatar_url')
                or user_meta.get('picture')
                or user_meta.get('avatar')
            )

            # Identities may contain provider-specific identity_data (Discord username & avatar)
            identities = user_obj.get('identities')
            if identities and isinstance(identities, (list, tuple)) and identities:
                id0 = identities[0]
                identity_data = id0.get('identity_data', {}) if isinstance(id0, dict) else {}

                id_custom = identity_data.get('custom_claims') if isinstance(identity_data, dict) else None
                id_global = id_custom.get('global_name') if isinstance(id_custom, dict) else None

                username = username or id_global or identity_data.get('global_name') or identity_data.get('username') or identity_data.get('name')
                avatar = avatar or identity_data.get('avatar') or identity_data.get('image') or identity_data.get('avatar_url')

        else:
            # object-like response
            meta = getattr(user_obj, 'user_metadata', None) or getattr(user_obj, 'raw_user_meta_data', None) or {}
            if isinstance(meta, dict):
                meta_custom = meta.get('custom_claims') if isinstance(meta, dict) else None
                meta_global = meta_custom.get('global_name') if isinstance(meta_custom, dict) else None
                username = meta_global or meta.get('global_name') or meta.get('username') or meta.get('name') or getattr(user_obj, 'email', None) or session.get('user_id')
                avatar = meta.get('avatar_url') or meta.get('picture') or meta.get('avatar')
            else:
                username = getattr(user_obj, 'email', None) or session.get('user_id')
                avatar = None

        g.user = {'username': username, 'avatar_url': avatar}
    except Exception:
        # On any failure, set a minimal g.user so templates can still render safely
        g.user = {'username': session.get('user_id'), 'avatar_url': None}


@app.route("/Logout")
def Logout():
    if "user_id" in session:
        try:
            get_authenticated_supabase().auth.sign_out()
        except Exception:
            pass
        session.clear()
        response = make_response(redirect(url_for("Home")))
        response.delete_cookie("access_token")
        response.delete_cookie("refresh_token")
        return response
    return redirect(url_for("Home"))


# Map
@app.route("/Camp-Plan")
def Camp_Plan():
    if "user_id" not in session:
        return redirect(url_for("Home"))

    if "camp_planner" not in session.get("permissions", []):
        abort(403, description="Forbidden")

    project_id = request.args["project_id"]
    supabase = get_authenticated_supabase()
    camp_plan_response = (
        supabase.table("Projects")
        .select("project_id, longitude, latitude, map_zoom")
        .eq("project_id", project_id)
        .execute()
    )

    tent_response = (
        supabase.table("TentObjects")
        .select("*")
        .eq("project_id", project_id)
        .execute()
    )

    areas_response = (
        supabase.table("areas")
        .select("*")
        .eq("project_id", project_id)
        .execute()
    )

    return render_template(
        "map/camp_plan.html",
        map_data=camp_plan_response.data,
        tent_data=tent_response.data,
        areas_data=areas_response.data,
    )


@app.route("/Camp-Plan-Public")
def Camp_Plan_Public():
    # Public read-only view of a project's camp plan. Only served when the project's
    # public_view_visible flag is True.
    project_id = request.args.get("project_id")
    if not project_id:
        abort(404, description="Resource not found")

    supabase = get_authenticated_supabase()

    project_resp = (
        supabase.table("Projects")
        .select("project_id, longitude, latitude, map_zoom, public_view_visible, project_name")
        .eq("project_id", project_id)
        .execute()
    )

    if not project_resp.data:
        abort(404, description="Resource not found")

    public_view = project_resp.data[0].get("public_view_visible")
    if public_view is not True:
        # Only allow if explicitly enabled
        abort(404, description="Resource not found")

    tent_response = (
        supabase.table("TentObjects")
        .select("*")
        .eq("project_id", project_id)
        .execute()
    )

    areas_response = (
        supabase.table("areas")
        .select("*")
        .eq("project_id", project_id)
        .execute()
    )

    return render_template(
            "map/camp_plan_public.html",
        map_data=project_resp.data,
        tent_data=tent_response.data,
        areas_data=areas_response.data,
    )


@app.route('/add_tent', methods=['POST'])
def add_tent():
    if "user_id" not in session or "camp_planner" not in session.get("permissions", []):
        return redirect(url_for("Home"))

    data = request.get_json()
    project_id = data["project_id"]
    supabase = get_authenticated_supabase()

    response = (
        supabase.table("TentObjects")
        .insert({
            "project_id": project_id,
            "group_name": data["group_name"],
            "nation": data["area"],
            "latitude": data["latitude"],
            "longitude": data["longitude"],
            "bell_size": data["bell_size"],
            "length": data["length"],
            "width": data["width"],
            "rotation": data["rotation"],
        })
        .execute()
    )

    if not response.data:
        return jsonify({"error": "Failed to create tent"}), 500

    return jsonify({"id": response.data[0]["object_id"]}), 201 # type: ignore


@app.route('/update_tent', methods=['POST'])
def update_tent():
    if "user_id" not in session or "camp_planner" not in session.get("permissions", []):
        return redirect(url_for("Home"))

    data = request.get_json()
    supabase = get_authenticated_supabase()

    supabase.table("TentObjects").update({
        "group_name": data["group_name"],
        "nation": data["area"],
        "latitude": data["latitude"],
        "longitude": data["longitude"],
        "bell_size": data["bell_size"],
        "length": data["length"],
        "width": data["width"],
        "rotation": data["rotation"],
    }).eq("object_id", data["object_id"]).execute()

    return jsonify({"success": True})


@app.route('/delete_tent', methods=['POST'])
def delete_tent():
    if "user_id" not in session or "camp_planner" not in session.get("permissions", []):
        return redirect(url_for("Home"))

    data = request.get_json()
    supabase = get_authenticated_supabase()

    supabase.table("TentObjects").delete().eq("object_id", data["object_id"]).execute()

    return jsonify({"success": True})


    # Areas API: persist and manage drawn areas (project-scoped)
@app.route('/api/areas', methods=['GET'])
def api_get_areas():
    project_id = request.args.get('project_id')
    if not project_id:
        return jsonify([])

    supabase_client = get_authenticated_supabase()
    resp = supabase_client.table('areas').select('*').eq('project_id', project_id).execute()
    return jsonify(resp.data)


@app.route('/api/areas', methods=['POST'])
def api_add_area():
    if "user_id" not in session or "camp_planner" not in session.get("permissions", []):
        return jsonify({'error': 'unauthorized'}), 403

    data = request.get_json()
    supabase_client = get_authenticated_supabase()

    row = {
        'project_id': data.get('project_id'),
        'area_name': data.get('area_name'),
        'geojson': data.get('geojson'),
        'color': data.get('color')
    }

    resp = supabase_client.table('areas').insert(row).execute()
    if getattr(resp, 'error', None):
        return jsonify({'error': str(resp.error)}), 500
    return jsonify(resp.data[0]), 201


@app.route('/api/areas/<area_id>', methods=['PUT'])
def api_update_area(area_id):
    if "user_id" not in session or "camp_planner" not in session.get("permissions", []):
        return jsonify({'error': 'unauthorized'}), 403

    data = request.get_json()
    supabase_client = get_authenticated_supabase()
    update = {}
    if 'area_name' in data:
        update['area_name'] = data['area_name']
    if 'geojson' in data:
        update['geojson'] = data['geojson']
    if 'color' in data:
        update['color'] = data['color']

    resp = supabase_client.table('areas').update(update).eq('area_id', area_id).execute()
    if getattr(resp, 'error', None):
        return jsonify({'error': str(resp.error)}), 500
    return jsonify({'success': True})


@app.route('/api/areas/<area_id>', methods=['DELETE'])
def api_delete_area(area_id):
    if "user_id" not in session or "camp_planner" not in session.get("permissions", []):
        return jsonify({'error': 'unauthorized'}), 403

    supabase_client = get_authenticated_supabase()
    resp = supabase_client.table('areas').delete().eq('area_id', area_id).execute()
    if getattr(resp, 'error', None):
        return jsonify({'error': str(resp.error)}), 500
    return jsonify({'success': True})


@app.route("/Camp-Form")
def Camp_Plan_Form():
    project_id = request.args["project_id"]
    response = (
        supabase.table("Projects")
        .select("public_form_visible")
        .eq("project_id", project_id)
        .execute()
    )
    public_form_visible = response.data[0]["public_form_visible"] # type: ignore

    if "user_id" in session or public_form_visible is True:
        return render_template("menus/camp_form.html", project_id=project_id)
    abort(404, description="Resource not found")


@app.route('/submit_camp_form', methods=['POST'])
def submit_camp_form():
    data = request.get_json()
    project_id = data["project_id"]
    response = (
        supabase.table("Projects")
        .select("public_form_visible")
        .eq("project_id", project_id)
        .execute()
    )
    public_form_visible = response.data[0]["public_form_visible"] # type: ignore

    if ("user_id" in session and "camp_planner" in session.get("permissions", [])) or public_form_visible is True:
        group_name = data["group_name"]
        nation = data["nation"]
        rows = []

        for tent in data["tents"]:
            rows.append({
                "project_id": project_id,
                "group_name": group_name,
                "nation": nation,
                "bell_size": tent.get("bell_size"),
                "length": tent.get("length"),
                "width": tent.get("width"),
            })

        supabase.table("TentObjects").insert(rows).execute()

        return jsonify({"success": True, "inserted": len(rows)})

    abort(404, description="Resource not found")


# Menu
@app.route("/Projects", methods=['GET', 'POST'])
def Projects():
    if "user_id" not in session:
        return redirect(url_for("Home"))

    if "camp_planner" not in session.get("permissions", []):
        abort(403, description="Forbidden")

    supabase = get_authenticated_supabase()

    if request.method == 'POST':
        project_name = request.form.get('project_name')
        latitude = request.form.get('latitude')
        longitude = request.form.get('longitude')
        zoom = request.form.get('zoom')

        response = (
            supabase.table("Projects")
            .insert({
                "project_name": project_name,
                "project_owner": session["user_id"],
                "longitude": longitude,
                "latitude": latitude,
                "map_zoom": zoom,
            })
            .execute()
        )

        supabase.table("PermissionsTable").insert({
            "project_id": response.data[0]["project_id"], # type: ignore
            "user_id": session["user_id"],
            "role": "owner",
        }).execute()

    result = supabase.table("Projects").select("*").execute()
    list_Of_Projects = result.data

    return render_template("menus/projects.html", list_Of_Projects=list_Of_Projects)


@app.route('/update-project-toggle', methods=['POST'])
def update_project_toggle():
    if "user_id" not in session or "camp_planner" not in session.get("permissions", []):
        return redirect(url_for("Home"))

    data = request.get_json()
    project_id = data.get('project_id')
    field = data.get('field')
    value = data.get('value')

    allowed_fields = ['public_form_visible', 'public_view_visible']
    if field not in allowed_fields:
        return jsonify({'success': False, 'message': 'Invalid field'}), 400

    supabase = get_authenticated_supabase()
    supabase.table("Projects").update({field: value}).eq("project_id", project_id).execute()

    return jsonify({'success': True})


# Error handling
@app.errorhandler(404)
def page_not_found(e):
    return render_template("error/404.html"), 404


@app.errorhandler(403)
def forbidden(e):
    return render_template("error/403.html"), 403


# Debug
@app.route("/debug")
def debug():
    supabase = get_authenticated_supabase()
    user = supabase.auth.get_user()
    return {
        "flask_user": session.get("user_id"),
        "session_user": session.get("user_id"),
        "supabase_user": str(user),
        "has_access_token": "access_token" in session,
        "has_refresh_token": "refresh_token" in session,
    }


if __name__ == "__main__":
    app.run(debug=False)
