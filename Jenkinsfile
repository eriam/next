pipeline {
    agent any

    options {
        disableConcurrentBuilds()
    }

    parameters {
        choice(name: 'DEPLOY_TARGET', choices: ['staging', 'production', 'both', 'none'], description: 'Cible de déploiement')
        booleanParam(name: 'RUN_E2E', defaultValue: true, description: 'Run the Playwright E2E gate before Deploy Production (uncheck for environments without the e2e runner)')
    }

    environment {
        BUILDER_HOST = '192.168.1.38'
        STAGING_HOST = '192.168.1.33'
        PROD_HOST    = '192.168.1.36'
        DEPLOY_USER  = 'root'
        APP_DIR      = '/opt/sage3'
        REGISTRY     = '192.168.1.30:3000'
        GITEA_REPO   = 'http://192.168.1.30:3000/gitea-admin/next.git'
        BRANCH       = 'dev'
    }

    stages {
        stage('Checkout') {
            steps { checkout scm }
        }

        stage('Build images') {
            steps {
                sshagent(credentials: ['jenkins-deploy-key']) {
                    sh """
                        ssh ${DEPLOY_USER}@${BUILDER_HOST} '
                            docker image prune -af 2>/dev/null || true &&
                            rm -rf /tmp/sage3-build &&
                            git clone --branch ${BRANCH} ${GITEA_REPO} /tmp/sage3-build &&
                            cd /tmp/sage3-build &&

                            docker build -f deployment/node_server/Dockerfile \
                                -t ${REGISTRY}/gitea-admin/sage3-node-server:latest . &&
                            docker push ${REGISTRY}/gitea-admin/sage3-node-server:latest &&

                            docker build -f deployment/node_files/Dockerfile \
                                -t ${REGISTRY}/gitea-admin/sage3-files:latest . &&
                            docker push ${REGISTRY}/gitea-admin/sage3-files:latest &&

                            docker build -f deployment/node_yjs/Dockerfile \
                                -t ${REGISTRY}/gitea-admin/sage3-yjs:latest . &&
                            docker push ${REGISTRY}/gitea-admin/sage3-yjs:latest &&

                            rm -rf /tmp/sage3-build
                        '
                    """
                }
            }
        }

        stage('Deploy Staging') {
            when { expression { params.DEPLOY_TARGET == 'staging' || params.DEPLOY_TARGET == 'both' } }
            steps {
                sshagent(credentials: ['jenkins-deploy-key']) {
                    sh """
                        ssh ${DEPLOY_USER}@${STAGING_HOST} '
                            mkdir -p ${APP_DIR} &&
                            cd ${APP_DIR} &&
                            [ -f .env ] || (echo "ERREUR: .env absent — SAGE3_SERVER et LDAP_BIND_PASSWORD requis" && exit 1) &&
                            grep -q LDAP_BIND_PASSWORD .env || (echo "ERREUR: LDAP_BIND_PASSWORD absent du .env" && exit 1) &&
                            git config --global --add safe.directory ${APP_DIR} 2>/dev/null || true &&
                            if [ -d .git ]; then
                                git fetch origin ${BRANCH} && git checkout -- . && git checkout ${BRANCH} && git checkout -- . && git pull origin ${BRANCH}
                            else
                                git clone --branch ${BRANCH} ${GITEA_REPO} /tmp/sage3-stg &&
                                cp -r /tmp/sage3-stg/. . &&
                                rm -rf /tmp/sage3-stg
                            fi &&
                            LDAP_PASS=\$(grep LDAP_BIND_PASSWORD .env | cut -d= -f2) &&
                            cp deployment/configurations/node/sage3-staging.hjson deployment/configurations/node/sage3-prod.hjson &&
                            sed -i "s/CHANGE_ME_LDAP_PASS/\${LDAP_PASS}/" deployment/configurations/node/sage3-prod.hjson &&
                            SECRETS_KEY=\$(grep SECRETS_ENCRYPTION_KEY .env | cut -d= -f2) &&
                            sed -i "s/CHANGE_ME_SECRETS_KEY/\${SECRETS_KEY}/" deployment/configurations/node/sage3-prod.hjson &&
                            cp .env deployment/.env &&
                            grep -q NODE_SERVER_REPLICAS deployment/.env    || echo NODE_SERVER_REPLICAS=1     >> deployment/.env &&
                            grep -q NODE_FILE_SERVER_REPLICAS deployment/.env || echo NODE_FILE_SERVER_REPLICAS=1 >> deployment/.env &&
                            docker compose -f deployment/docker-compose-amd64.yml \
                                -f deployment/docker-compose.registry-override.yml pull &&
                            docker compose -f deployment/docker-compose-amd64.yml \
                                -f deployment/docker-compose.registry-override.yml up -d &&
                            docker image prune -f
                        '
                    """
                }
            }
        }

        stage('E2E gate (staging)') {
            // Only gates the full staging->prod release. Runs the Playwright functional
            // suite (smoke + rooms/boards + credentials + app availability + SSH terminal)
            // against staging on the dedicated runner; a failure fails the build and
            // prevents the Deploy Production stage below from running.
            when { expression { params.DEPLOY_TARGET == 'both' && params.RUN_E2E } }
            agent { label 'e2e' }
            steps {
                script {
                    // Fail-open on missing infra: if this agent has no Playwright / browser
                    // cache, skip the gate (prod still deploys) rather than blocking on it.
                    // A real test failure below still fails the build and blocks production.
                    def e2eReady = sh(script: 'command -v npx >/dev/null 2>&1 && test -d /opt/ms-playwright', returnStatus: true) == 0
                    if (!e2eReady) {
                        echo 'WARNING: Playwright / browser cache not found on this agent — SKIPPING the E2E gate. Production will deploy without E2E validation.'
                    } else {
                        dir('e2e') {
                            withCredentials([usernamePassword(credentialsId: 'sage3-e2e-ldap', usernameVariable: 'SAGE3_USER', passwordVariable: 'SAGE3_PASS')]) {
                                sh '''
                                    set -e
                                    export PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
                                    export BASE_URL=https://sage3-staging.mediavirtuel.com
                                    # The specs default to guest login; our instances use LDAP.
                                    export SAGE3_AUTH=ldap
                                    # Second LAB.LOCAL account for the cross-user tests (owner isolation,
                                    # control transfer, credential-delete authz). It shares the password
                                    # scheme with the primary account, so reuse SAGE3_PASS rather than a
                                    # second Jenkins credential. If unset, those tests test.skip themselves.
                                    export SAGE3_USER2=e2e-test2
                                    export SAGE3_PASS2="$SAGE3_PASS"
                                    # Slow each action enough to clear open-animation races. The suite is
                                    # validated at >=120ms; SLOWMO_MS=0 is known to race the shared fixtures.
                                    export SLOWMO_MS=150
                                    # wait for staging to answer after the deploy (up -d returns before healthy)
                                    for i in $(seq 1 30); do curl -fsSk "$BASE_URL/api/info" >/dev/null 2>&1 && break; sleep 5; done
                                    npm install --no-audit --no-fund @playwright/test@1.61.1

                                    # Best-effort: stand up a throwaway sshd target for the SSH-terminal spec.
                                    # staging's homebase must reach it, so advertise the runner's LAN IP. If
                                    # docker is unavailable or bring-up fails, the SSH tests test.skip themselves
                                    # (SSH_TARGET_* stay unset) and the rest of the suite still gates the release.
                                    SSH_UP=0
                                    if command -v docker >/dev/null 2>&1; then
                                        if SSH_ENV="$(SSH_TARGET_PORT=2201 SSH_TARGET_USER=e2e bash scripts/ssh-target.sh up)"; then
                                            eval "$SSH_ENV"
                                            LAN_IP="$(hostname -I | tr ' ' '\\n' | grep -E '^192\\.168\\.' | head -1)"
                                            [ -n "$LAN_IP" ] && export SSH_TARGET_HOST="$LAN_IP"
                                            SSH_UP=1
                                        fi
                                    fi

                                    set +e
                                    npx playwright test --project=chromium
                                    RC=$?
                                    set -e

                                    # Always tear the target down (even on a partial bring-up or test failure).
                                    command -v docker >/dev/null 2>&1 && SSH_TARGET_PORT=2201 bash scripts/ssh-target.sh down || true
                                    exit $RC
                                '''
                            }
                        }
                    }
                }
            }
            post {
                always {
                    archiveArtifacts artifacts: 'e2e/playwright-report/**, e2e/test-results/**', allowEmptyArchive: true
                    // Also publish the report + video to the CIFS share, one folder per run,
                    // and rotate anything older than 8 days.
                    sh '''
                        if mountpoint -q /mnt/donnees; then
                            DEST="/mnt/donnees/e2e-reports/sage3/${BUILD_NUMBER}-$(date +%Y%m%d-%H%M%S)"
                            mkdir -p "$DEST"
                            cp -r e2e/playwright-report "$DEST"/ 2>/dev/null || true
                            cp -r e2e/test-results   "$DEST"/ 2>/dev/null || true
                            find /mnt/donnees/e2e-reports/sage3 -maxdepth 1 -mindepth 1 -type d -mtime +8 -exec rm -rf {} + 2>/dev/null || true
                            echo "E2E artifacts -> $DEST"
                        else
                            echo "WARN: /mnt/donnees not mounted on this agent; skipping CIFS copy" >&2
                        fi
                    '''
                }
            }
        }

        stage('Deploy Production') {
            when {
                expression { params.DEPLOY_TARGET == 'production' || params.DEPLOY_TARGET == 'both' }
            }
            steps {
                sshagent(credentials: ['jenkins-deploy-key']) {
                    sh """
                        ssh ${DEPLOY_USER}@${PROD_HOST} '
                            mkdir -p ${APP_DIR} &&
                            cd ${APP_DIR} &&
                            [ -f .env ] || (echo "ERREUR: .env absent — SAGE3_SERVER et LDAP_BIND_PASSWORD requis" && exit 1) &&
                            grep -q LDAP_BIND_PASSWORD .env || (echo "ERREUR: LDAP_BIND_PASSWORD absent du .env" && exit 1) &&
                            git config --global --add safe.directory ${APP_DIR} 2>/dev/null || true &&
                            if [ -d .git ]; then
                                git fetch origin ${BRANCH} && git checkout -- . && git checkout ${BRANCH} && git checkout -- . && git pull origin ${BRANCH}
                            else
                                git clone --branch ${BRANCH} ${GITEA_REPO} /tmp/sage3-deploy &&
                                cp -r /tmp/sage3-deploy/. . &&
                                rm -rf /tmp/sage3-deploy
                            fi &&
                            LDAP_PASS=\$(grep LDAP_BIND_PASSWORD .env | cut -d= -f2) &&
                            sed -i "s/CHANGE_ME_LDAP_PASS/\${LDAP_PASS}/" deployment/configurations/node/sage3-prod.hjson &&
                            SECRETS_KEY=\$(grep SECRETS_ENCRYPTION_KEY .env | cut -d= -f2) &&
                            sed -i "s/CHANGE_ME_SECRETS_KEY/\${SECRETS_KEY}/" deployment/configurations/node/sage3-prod.hjson &&
                            cp .env deployment/.env &&
                            grep -q NODE_SERVER_REPLICAS deployment/.env    || echo NODE_SERVER_REPLICAS=3     >> deployment/.env &&
                            grep -q NODE_FILE_SERVER_REPLICAS deployment/.env || echo NODE_FILE_SERVER_REPLICAS=1 >> deployment/.env &&
                            docker compose -f deployment/docker-compose-amd64.yml \
                                -f deployment/docker-compose.registry-override.yml pull &&
                            docker compose -f deployment/docker-compose-amd64.yml \
                                -f deployment/docker-compose.registry-override.yml up -d &&
                            docker image prune -f
                        '
                    """
                }
            }
        }
    }

    post {
        success { echo "Pipeline SAGE3 OK — cible: ${params.DEPLOY_TARGET}" }
        failure { echo "Pipeline SAGE3 ECHEC — cible: ${params.DEPLOY_TARGET}" }
    }
}
